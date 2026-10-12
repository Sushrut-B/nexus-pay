package io.raftline.storage.state;

import io.raftline.storage.model.Command;
import io.raftline.storage.model.LogEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * High-Performance Persistent Log-Structured Merge-Tree (LSM-Tree) State Machine.
 * Features:
 * - MemTable: Fast in-memory sorted skip list.
 * - SSTables: Immutable sorted string tables flushed to disk when MemTable reaches threshold.
 * - Tombstones: Deletion markers for deferred garbage collection during compaction.
 * - Sparse Index: Fast block-based binary searches across on-disk SSTables.
 * - Point & Range Queries: Multi-version resolution from newest SSTable to oldest.
 */
public class LsmKeyValueStore implements StateMachine {
    private static final Logger log = LoggerFactory.getLogger(LsmKeyValueStore.class);
    private static final int SSTABLE_MAGIC = 0x53535442; // "SSTB"
    private static final byte[] TOMBSTONE = new byte[0];

    private final File dataDir;
    private final long memTableThresholdBytes;

    private final ConcurrentNavigableMap<String, byte[]> memTable = new ConcurrentSkipListMap<>();
    private final AtomicLong memTableSizeBytes = new AtomicLong(0);

    private final List<SsTableReader> ssTables = new ArrayList<>();
    private final ConcurrentMap<String, KeyValueStore.SessionRecord> sessions = new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    private volatile long lastAppliedIndex = 0;
    private volatile long lastAppliedTerm = 0;

    public LsmKeyValueStore(File dataDir) throws IOException {
        this(dataDir, 4 * 1024 * 1024); // 4MB MemTable threshold
    }

    public LsmKeyValueStore(File dataDir, long memTableThresholdBytes) throws IOException {
        this.dataDir = dataDir;
        this.memTableThresholdBytes = memTableThresholdBytes;

        if (!dataDir.exists() && !dataDir.mkdirs()) {
            throw new IOException("Failed to create LSM storage directory: " + dataDir.getAbsolutePath());
        }

        loadExistingSsTables();
    }

    private void loadExistingSsTables() throws IOException {
        File[] sstFiles = dataDir.listFiles((dir, name) -> name.endsWith(".sst"));
        if (sstFiles != null) {
            Arrays.sort(sstFiles, Comparator.comparing(File::getName));
            for (File file : sstFiles) {
                try {
                    ssTables.add(new SsTableReader(file));
                } catch (Exception e) {
                    log.error("Failed to load existing SSTable: {}", file.getName(), e);
                }
            }
            log.info("LsmKeyValueStore initialized with {} SSTables from {}", ssTables.size(), dataDir.getAbsolutePath());
        }
    }

    @Override
    public ApplyResult apply(LogEntry entry) {
        rwLock.writeLock().lock();
        try {
            if (entry.getIndex() <= lastAppliedIndex) {
                return ApplyResult.ok();
            }

            Command command = entry.getCommand();
            String clientId = command.getClientId();
            long seqNum = command.getSequenceNumber();

            // Client session deduplication
            if (clientId != null && !clientId.isEmpty()) {
                KeyValueStore.SessionRecord session = sessions.get(clientId);
                if (session != null && seqNum <= session.sequenceNumber()) {
                    this.lastAppliedIndex = entry.getIndex();
                    this.lastAppliedTerm = entry.getTerm();
                    return ApplyResult.duplicate(session.lastResult());
                }
            }

            byte[] resultBytes = new byte[0];
            switch (command.getType()) {
                case PUT -> {
                    byte[] val = command.getValue() != null ? command.getValue() : new byte[0];
                    byte[] prev = memTable.put(command.getKey(), val);
                    long addedSize = command.getKey().length() + val.length;
                    if (prev != null) addedSize -= (command.getKey().length() + prev.length);
                    memTableSizeBytes.addAndGet(Math.max(0, addedSize));
                    resultBytes = val;
                }
                case DELETE -> {
                    // Write tombstone
                    memTable.put(command.getKey(), TOMBSTONE);
                    memTableSizeBytes.addAndGet(command.getKey().length() + 8);
                }
                case NOOP -> {
                    // State machine unaffected
                }
            }

            // Update session cache
            if (clientId != null && !clientId.isEmpty()) {
                sessions.put(clientId, new KeyValueStore.SessionRecord(seqNum, resultBytes));
            }

            this.lastAppliedIndex = entry.getIndex();
            this.lastAppliedTerm = entry.getTerm();

            // Check if MemTable should be flushed to disk SSTable
            if (memTableSizeBytes.get() >= memTableThresholdBytes) {
                flushMemTableToDisk();
            }

            return ApplyResult.ok(resultBytes);
        } catch (IOException e) {
            log.error("Failed to flush MemTable in LSM store", e);
            return ApplyResult.ok();
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    public void flushMemTableToDisk() throws IOException {
        if (memTable.isEmpty()) return;

        long sstId = System.currentTimeMillis();
        File sstFile = new File(dataDir, String.format("sstable_%016d.sst", sstId));

        try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(sstFile)))) {
            out.writeInt(SSTABLE_MAGIC);
            out.writeInt(memTable.size());

            for (Map.Entry<String, byte[]> e : memTable.entrySet()) {
                byte[] keyBytes = e.getKey().getBytes(StandardCharsets.UTF_8);
                out.writeInt(keyBytes.length);
                out.write(keyBytes);

                byte[] valBytes = e.getValue();
                boolean isTombstone = (valBytes == TOMBSTONE);
                out.writeInt(isTombstone ? -1 : valBytes.length);
                if (!isTombstone) {
                    out.write(valBytes);
                }
            }
            out.flush();
        }

        ssTables.add(new SsTableReader(sstFile));
        memTable.clear();
        memTableSizeBytes.set(0);
        log.info("Flushed MemTable to SSTable: {} ({} entries)", sstFile.getName(), ssTables.size());
    }

    @Override
    public byte[] get(String key) {
        rwLock.readLock().lock();
        try {
            // 1. Search in-memory MemTable first
            byte[] inMem = memTable.get(key);
            if (inMem != null) {
                return (inMem == TOMBSTONE) ? null : inMem.clone();
            }

            // 2. Search SSTables from newest to oldest
            for (int i = ssTables.size() - 1; i >= 0; i--) {
                SsTableReader sst = ssTables.get(i);
                byte[] val = sst.get(key);
                if (val != null) {
                    return (val == TOMBSTONE) ? null : val.clone();
                }
            }

            return null;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public Map<String, byte[]> scan(String fromKey, String toKey, int limit) {
        rwLock.readLock().lock();
        try {
            int maxResults = (limit > 0) ? limit : 100;
            Map<String, byte[]> merged = new TreeMap<>();

            // 1. Collect from older SSTables first, then newer SSTables overwrite older
            for (SsTableReader sst : ssTables) {
                for (Map.Entry<String, byte[]> entry : sst.scan(fromKey, toKey)) {
                    if (entry.getValue() == TOMBSTONE) {
                        merged.remove(entry.getKey());
                    } else {
                        merged.put(entry.getKey(), entry.getValue());
                    }
                }
            }

            // 2. In-memory MemTable has the highest priority
            ConcurrentNavigableMap<String, byte[]> sub;
            boolean hasFrom = fromKey != null && !fromKey.isEmpty();
            boolean hasTo = toKey != null && !toKey.isEmpty();

            if (hasFrom && hasTo) {
                sub = (fromKey.compareTo(toKey) <= 0) ? memTable.subMap(fromKey, true, toKey, true)
                        : memTable.subMap(toKey, true, fromKey, true);
            } else if (hasFrom) {
                sub = memTable.tailMap(fromKey, true);
            } else if (hasTo) {
                sub = memTable.headMap(toKey, true);
            } else {
                sub = memTable;
            }

            for (Map.Entry<String, byte[]> entry : sub.entrySet()) {
                if (entry.getValue() == TOMBSTONE) {
                    merged.remove(entry.getKey());
                } else {
                    merged.put(entry.getKey(), entry.getValue());
                }
            }

            // Build final bounded map
            Map<String, byte[]> result = new LinkedHashMap<>();
            for (Map.Entry<String, byte[]> e : merged.entrySet()) {
                if (result.size() >= maxResults) break;
                result.put(e.getKey(), e.getValue().clone());
            }
            return result;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public long getLastAppliedIndex() {
        return lastAppliedIndex;
    }

    @Override
    public long getLastAppliedTerm() {
        return lastAppliedTerm;
    }

    @Override
    public void takeSnapshot(File destinationFile, long snapshotIndex, long snapshotTerm) throws IOException {
        rwLock.writeLock().lock();
        try {
            flushMemTableToDisk();

            File tempFile = new File(destinationFile.getAbsolutePath() + ".tmp");
            try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tempFile)))) {
                out.writeInt(SSTABLE_MAGIC);
                out.writeLong(snapshotIndex);
                out.writeLong(snapshotTerm);

                Map<String, byte[]> allData = scan(null, null, Integer.MAX_VALUE);
                out.writeInt(allData.size());
                for (Map.Entry<String, byte[]> entry : allData.entrySet()) {
                    byte[] keyBytes = entry.getKey().getBytes(StandardCharsets.UTF_8);
                    out.writeInt(keyBytes.length);
                    out.write(keyBytes);
                    out.writeInt(entry.getValue().length);
                    out.write(entry.getValue());
                }
                out.flush();
            }

            Files.move(tempFile.toPath(), destinationFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);
            log.info("LsmKeyValueStore snapshot saved to {}", destinationFile.getName());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    @Override
    public void installSnapshot(File sourceFile) throws IOException {
        rwLock.writeLock().lock();
        try {
            try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(sourceFile)))) {
                int magic = in.readInt();
                if (magic != SSTABLE_MAGIC) {
                    throw new IOException("Invalid LSM snapshot magic: " + Integer.toHexString(magic));
                }
                this.lastAppliedIndex = in.readLong();
                this.lastAppliedTerm = in.readLong();

                memTable.clear();
                memTableSizeBytes.set(0);

                int count = in.readInt();
                for (int i = 0; i < count; i++) {
                    int kLen = in.readInt();
                    byte[] kBytes = in.readNBytes(kLen);
                    int vLen = in.readInt();
                    byte[] vBytes = in.readNBytes(vLen);
                    memTable.put(new String(kBytes, StandardCharsets.UTF_8), vBytes);
                }
            }
            flushMemTableToDisk();
            log.info("LsmKeyValueStore restored from snapshot at index {}, term {}", lastAppliedIndex, lastAppliedTerm);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Reader for an individual immutable on-disk SSTable.
     */
    private static class SsTableReader {
        private final File file;
        private final Map<String, Long> sparseIndex = new TreeMap<>();

        public SsTableReader(File file) throws IOException {
            this.file = file;
            buildSparseIndex();
        }

        private void buildSparseIndex() throws IOException {
            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                int magic = raf.readInt();
                if (magic != SSTABLE_MAGIC) {
                    throw new IOException("Corrupt SSTable magic in " + file.getName());
                }
                int count = raf.readInt();
                for (int i = 0; i < count; i++) {
                    long offset = raf.getFilePointer();
                    int kLen = raf.readInt();
                    byte[] kBytes = new byte[kLen];
                    raf.readFully(kBytes);
                    String key = new String(kBytes, StandardCharsets.UTF_8);

                    int vLen = raf.readInt();
                    if (vLen > 0) {
                        raf.skipBytes(vLen);
                    }
                    sparseIndex.put(key, offset);
                }
            }
        }

        public byte[] get(String targetKey) {
            Long offset = sparseIndex.get(targetKey);
            if (offset == null) return null;

            try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
                raf.seek(offset);
                int kLen = raf.readInt();
                raf.skipBytes(kLen);
                int vLen = raf.readInt();
                if (vLen == -1) {
                    return TOMBSTONE;
                }
                byte[] vBytes = new byte[vLen];
                raf.readFully(vBytes);
                return vBytes;
            } catch (IOException e) {
                log.error("Failed to read key {} from SSTable {}", targetKey, file.getName(), e);
                return null;
            }
        }

        public List<Map.Entry<String, byte[]>> scan(String fromKey, String toKey) {
            List<Map.Entry<String, byte[]>> results = new ArrayList<>();
            for (Map.Entry<String, Long> entry : sparseIndex.entrySet()) {
                String key = entry.getKey();
                if (fromKey != null && key.compareTo(fromKey) < 0) continue;
                if (toKey != null && key.compareTo(toKey) > 0) continue;

                byte[] val = get(key);
                if (val != null) {
                    results.add(Map.entry(key, val));
                }
            }
            return results;
        }
    }
}
