package io.raftline.storage.wal;

import io.raftline.storage.model.LogEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Durable, append-only Write-Ahead Log (WAL) with CRC32 verification,
 * crash recovery with torn-write auto-trimming, suffix truncation (for uncommitted rollbacks),
 * and prefix compaction (for snapshots).
 */
public class WriteAheadLog implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(WriteAheadLog.class);
    private static final String LOG_FILE_NAME = "raft.wal";

    private final File logDir;
    private final File walFile;
    private final boolean syncOnAppend;

    private RandomAccessFile raf;
    private FileChannel fileChannel;

    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();
    // In-memory index: maps logIndex -> LogEntry
    private final ConcurrentNavigableMap<Long, LogEntry> entryIndex = new ConcurrentSkipListMap<>();
    // Maps logIndex -> file offset of the entry header
    private final ConcurrentNavigableMap<Long, Long> offsetIndex = new ConcurrentSkipListMap<>();

    private volatile long snapshotIndex = 0;
    private volatile long snapshotTerm = 0;

    public WriteAheadLog(File logDir) throws IOException {
        this(logDir, true);
    }

    public WriteAheadLog(File logDir, boolean syncOnAppend) throws IOException {
        this.logDir = logDir;
        this.syncOnAppend = syncOnAppend;

        if (!logDir.exists() && !logDir.mkdirs()) {
            throw new IOException("Failed to create WAL directory: " + logDir.getAbsolutePath());
        }

        this.walFile = new File(logDir, LOG_FILE_NAME);
        openAndRecover();
    }

    private void openAndRecover() throws IOException {
        rwLock.writeLock().lock();
        try {
            this.raf = new RandomAccessFile(walFile, "rw");
            this.fileChannel = raf.getChannel();

            recoverLog();
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Reads all entries from the WAL file sequentially, verifying CRC32 checksums.
     * If a corrupt or truncated record is found at the tail (torn write during crash),
     * the log file is truncated to the last known good position.
     */
    private void recoverLog() throws IOException {
        entryIndex.clear();
        offsetIndex.clear();

        long fileSize = fileChannel.size();
        if (fileSize == 0) {
            log.info("WAL file is empty. Initialized fresh WAL at {}", walFile.getAbsolutePath());
            return;
        }

        long currentOffset = 0;
        ByteBuffer headerBuffer = ByteBuffer.allocate(8); // CRC (4) + Length (4)

        log.info("Recovering WAL from {} (file size: {} bytes)...", walFile.getAbsolutePath(), fileSize);

        while (currentOffset + 8 <= fileSize) {
            headerBuffer.clear();
            fileChannel.position(currentOffset);
            int read = fileChannel.read(headerBuffer);
            if (read < 8) {
                log.warn("Incomplete frame header at offset {}. Truncating tail.", currentOffset);
                break;
            }

            headerBuffer.flip();
            int expectedCrc = headerBuffer.getInt();
            int payloadLength = headerBuffer.getInt();

            if (payloadLength <= 0 || currentOffset + 8 + payloadLength > fileSize) {
                log.warn("Torn or invalid payload length {} at offset {}. Truncating tail.", payloadLength, currentOffset);
                break;
            }

            ByteBuffer fullFrameBuffer = ByteBuffer.allocate(8 + payloadLength);
            fullFrameBuffer.putInt(expectedCrc);
            fullFrameBuffer.putInt(payloadLength);

            ByteBuffer payloadBuffer = ByteBuffer.allocate(payloadLength);
            fileChannel.read(payloadBuffer);
            payloadBuffer.flip();
            fullFrameBuffer.put(payloadBuffer);
            fullFrameBuffer.flip();

            try {
                LogEntry entry = LogEntry.deserialize(fullFrameBuffer);
                entryIndex.put(entry.getIndex(), entry);
                offsetIndex.put(entry.getIndex(), currentOffset);
                currentOffset += (8 + payloadLength);
            } catch (Exception e) {
                log.warn("Corrupted record detected at offset {}: {}. Truncating tail.", currentOffset, e.getMessage());
                break;
            }
        }

        // If file has trailing partial bytes, truncate them safely
        if (currentOffset < fileSize) {
            log.warn("Truncating corrupted/partial trailing bytes from offset {} down from {}", currentOffset, fileSize);
            fileChannel.truncate(currentOffset);
            if (syncOnAppend) {
                fileChannel.force(true);
            }
        }

        log.info("WAL recovery complete. Recovered {} valid entries. LastIndex={}, LastTerm={}",
                entryIndex.size(), getLastLogIndex(), getLastLogTerm());
    }

    /**
     * Appends a single log entry to the WAL durably.
     */
    public void append(LogEntry entry) throws IOException {
        append(Collections.singletonList(entry));
    }

    /**
     * Appends a batch of log entries.
     */
    public void append(List<LogEntry> entries) throws IOException {
        if (entries == null || entries.isEmpty()) {
            return;
        }

        rwLock.writeLock().lock();
        try {
            long currentOffset = fileChannel.size();
            fileChannel.position(currentOffset);

            for (LogEntry entry : entries) {
                long expectedIndex = getLastLogIndex() + 1;
                if (entry.getIndex() != expectedIndex) {
                    throw new IllegalArgumentException(
                            "Non-consecutive log index: expected " + expectedIndex + " but got " + entry.getIndex());
                }

                byte[] serialized = entry.serialize();
                ByteBuffer buffer = ByteBuffer.wrap(serialized);
                while (buffer.hasRemaining()) {
                    fileChannel.write(buffer);
                }

                entryIndex.put(entry.getIndex(), entry);
                offsetIndex.put(entry.getIndex(), currentOffset);
                currentOffset += serialized.length;
            }

            if (syncOnAppend) {
                fileChannel.force(false);
            }
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Gets a single log entry by its 1-based index.
     * Returns null if entry does not exist or has been compacted.
     */
    public LogEntry getEntry(long index) {
        rwLock.readLock().lock();
        try {
            return entryIndex.get(index);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    /**
     * Gets a contiguous range of entries starting from {@code fromIndex}.
     */
    public List<LogEntry> getEntriesFrom(long fromIndex, int maxCount) {
        rwLock.readLock().lock();
        try {
            if (fromIndex > getLastLogIndex()) {
                return Collections.emptyList();
            }

            List<LogEntry> result = new ArrayList<>();
            long currentIndex = fromIndex;
            while (result.size() < maxCount && currentIndex <= getLastLogIndex()) {
                LogEntry entry = entryIndex.get(currentIndex);
                if (entry != null) {
                    result.add(entry);
                }
                currentIndex++;
            }
            return result;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    /**
     * Raft §5.3: Truncates conflicting uncommitted entries starting from {@code fromIndex} onwards.
     * Any entry with index >= fromIndex is erased from both disk and memory.
     */
    public void truncateSuffix(long fromIndex) throws IOException {
        rwLock.writeLock().lock();
        try {
            if (fromIndex > getLastLogIndex()) {
                return; // Nothing to truncate
            }

            if (fromIndex <= snapshotIndex) {
                throw new IllegalStateException("Cannot truncate committed snapshot entries at index <= " + snapshotIndex);
            }

            Long truncateOffset = offsetIndex.get(fromIndex);
            if (truncateOffset == null) {
                // If offset not found, re-evaluate or use size
                truncateOffset = fileChannel.size();
            }

            // Truncate file physically
            fileChannel.truncate(truncateOffset);
            if (syncOnAppend) {
                fileChannel.force(true);
            }

            // Remove from memory indexes
            entryIndex.tailMap(fromIndex, true).clear();
            offsetIndex.tailMap(fromIndex, true).clear();

            log.info("Truncated WAL suffix from index {} (offset {}). New LastIndex={}",
                    fromIndex, truncateOffset, getLastLogIndex());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Compacts the WAL prefix up to {@code upToSnapshotIndex}.
     * Clears compacted entries from memory.
     */
    public void setSnapshotBoundary(long snapshotIndex, long snapshotTerm) {
        rwLock.writeLock().lock();
        try {
            this.snapshotIndex = snapshotIndex;
            this.snapshotTerm = snapshotTerm;

            // Remove compacted entries from in-memory index
            entryIndex.headMap(snapshotIndex + 1, false).clear();
            offsetIndex.headMap(snapshotIndex + 1, false).clear();

            log.info("WAL updated snapshot boundary: snapshotIndex={}, snapshotTerm={}. In-memory log now starts from {}",
                    snapshotIndex, snapshotTerm, getFirstLogIndex());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    public long getFirstLogIndex() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) {
                return snapshotIndex + 1;
            }
            return entryIndex.firstKey();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getLastLogIndex() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) {
                return snapshotIndex;
            }
            return entryIndex.lastKey();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getLastLogTerm() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) {
                return snapshotTerm;
            }
            LogEntry lastEntry = entryIndex.lastEntry().getValue();
            return lastEntry != null ? lastEntry.getTerm() : snapshotTerm;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getTermForIndex(long index) {
        rwLock.readLock().lock();
        try {
            if (index == 0) {
                return 0;
            }
            if (index == snapshotIndex) {
                return snapshotTerm;
            }
            LogEntry entry = entryIndex.get(index);
            if (entry != null) {
                return entry.getTerm();
            }
            return 0;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getSnapshotIndex() {
        return snapshotIndex;
    }

    public long getSnapshotTerm() {
        return snapshotTerm;
    }

    public int getLogEntryCount() {
        rwLock.readLock().lock();
        try {
            return entryIndex.size();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public void close() throws IOException {
        rwLock.writeLock().lock();
        try {
            if (fileChannel != null && fileChannel.isOpen()) {
                if (syncOnAppend) {
                    fileChannel.force(true);
                }
                fileChannel.close();
            }
            if (raf != null) {
                raf.close();
            }
        } finally {
            rwLock.writeLock().unlock();
        }
    }
}
