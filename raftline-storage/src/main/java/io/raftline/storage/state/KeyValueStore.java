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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Thread-safe In-Memory Key-Value State Machine with client session deduplication,
 * range scans, and point-in-time binary snapshotting.
 */
public class KeyValueStore implements StateMachine {
    private static final Logger log = LoggerFactory.getLogger(KeyValueStore.class);
    private static final int SNAPSHOT_MAGIC = 0x52414654; // "RAFT"

    private final ConcurrentNavigableMap<String, byte[]> data = new ConcurrentSkipListMap<>();
    private final ConcurrentMap<String, Long> versions = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, SessionRecord> sessions = new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    private volatile long lastAppliedIndex = 0;
    private volatile long lastAppliedTerm = 0;

    public static record SessionRecord(long sequenceNumber, byte[] lastResult, long version) {
        public SessionRecord(long sequenceNumber, byte[] lastResult) {
            this(sequenceNumber, lastResult, 0L);
        }
    }

    @Override
    public ApplyResult apply(LogEntry entry) {
        rwLock.writeLock().lock();
        try {
            if (entry.getIndex() <= lastAppliedIndex) {
                log.warn("Ignoring already applied log entry: index={}, lastApplied={}", entry.getIndex(), lastAppliedIndex);
                return ApplyResult.ok();
            }

            Command command = entry.getCommand();
            String clientId = command.getClientId();
            long seqNum = command.getSequenceNumber();

            // Check client idempotency deduplication
            if (clientId != null && !clientId.isEmpty()) {
                SessionRecord session = sessions.get(clientId);
                if (session != null && seqNum <= session.sequenceNumber()) {
                    log.info("Duplicate command detected for client={}, seqNum={}. Returning cached result.", clientId, seqNum);
                    this.lastAppliedIndex = entry.getIndex();
                    this.lastAppliedTerm = entry.getTerm();
                    return ApplyResult.duplicate(session.lastResult());
                }
            }

            byte[] resultBytes = new byte[0];
            long resultVersion = 0;
            boolean casFailed = false;

            switch (command.getType()) {
                case PUT: {
                    long currentVer = versions.getOrDefault(command.getKey(), 0L);
                    long newVer = currentVer + 1;
                    versions.put(command.getKey(), newVer);
                    data.put(command.getKey(), command.getValue());
                    resultBytes = command.getValue();
                    resultVersion = newVer;
                    break;
                }
                case CAS: {
                    long currentVer = versions.getOrDefault(command.getKey(), 0L);
                    long expectedVer = command.getExpectedVersion();
                    byte[] currentVal = data.get(command.getKey());

                    if (currentVer != expectedVer) {
                        // Conflict / version mismatch
                        casFailed = true;
                        resultBytes = currentVal != null ? currentVal.clone() : new byte[0];
                        resultVersion = currentVer;
                    } else {
                        long newVer = currentVer + 1;
                        versions.put(command.getKey(), newVer);
                        data.put(command.getKey(), command.getValue());
                        resultBytes = command.getValue();
                        resultVersion = newVer;
                    }
                    break;
                }
                case DELETE: {
                    byte[] previous = data.remove(command.getKey());
                    versions.remove(command.getKey());
                    resultBytes = previous != null ? previous : new byte[0];
                    resultVersion = 0;
                    break;
                }
                case NOOP:
                    // Heartbeat or leader establishment entry
                    break;
                case MULTI_PUT: {
                    // Atomic multi-key mutation guarded by an idempotency precondition.
                    // The guard is evaluated while the write lock is held, so the
                    // "check the idempotency table, then mutate" sequence cannot be
                    // interleaved by a concurrent command on any replica.
                    io.raftline.storage.model.MultiPutPayload payload;
                    try {
                        payload = io.raftline.storage.model.MultiPutPayload.decode(command.getValue());
                    } catch (IOException e) {
                        this.lastAppliedIndex = entry.getIndex();
                        this.lastAppliedTerm = entry.getTerm();
                        return ApplyResult.error("MALFORMED_MULTI_PUT");
                    }
                    if (payload.hasGuard()) {
                        byte[] existing = data.get(payload.guardKey());
                        if (existing != null) {
                            boolean identical = java.util.Arrays.equals(existing, payload.guardValue());
                            this.lastAppliedIndex = entry.getIndex();
                            this.lastAppliedTerm = entry.getTerm();
                            return ApplyResult.error(identical
                                    ? io.raftline.storage.model.MultiPutPayload.REJECT_DUPLICATE
                                    : io.raftline.storage.model.MultiPutPayload.REJECT_CONFLICT);
                        }
                    }
                    long maxVersion = 0L;
                    for (io.raftline.storage.model.MultiPutPayload.Entry e : payload.entries()) {
                        long currentVer = versions.getOrDefault(e.key(), 0L);
                        versions.put(e.key(), currentVer + 1);
                        data.put(e.key(), e.value());
                        maxVersion = Math.max(maxVersion, currentVer + 1);
                    }
                    resultBytes = command.getValue();
                    resultVersion = maxVersion;
                    break;
                }
            }

            // Update session cache
            if (clientId != null && !clientId.isEmpty()) {
                sessions.put(clientId, new SessionRecord(seqNum, resultBytes, resultVersion));
            }

            this.lastAppliedIndex = entry.getIndex();
            this.lastAppliedTerm = entry.getTerm();

            if (casFailed) {
                return ApplyResult.casMismatch(resultVersion, resultBytes);
            }
            return ApplyResult.ok(resultBytes, resultVersion);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    @Override
    public byte[] get(String key) {
        rwLock.readLock().lock();
        try {
            byte[] value = data.get(key);
            return value != null ? value.clone() : null;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public VersionedValue getVersioned(String key) {
        rwLock.readLock().lock();
        try {
            byte[] value = data.get(key);
            long ver = versions.getOrDefault(key, 0L);
            return new VersionedValue(value != null ? value.clone() : null, ver);
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public Map<String, byte[]> scan(String fromKey, String toKey, int limit) {
        rwLock.readLock().lock();
        try {
            ConcurrentNavigableMap<String, byte[]> sub;
            boolean hasFrom = fromKey != null && !fromKey.isEmpty();
            boolean hasTo = toKey != null && !toKey.isEmpty();

            if (hasFrom && hasTo) {
                if (fromKey.compareTo(toKey) <= 0) {
                    sub = data.subMap(fromKey, true, toKey, true);
                } else {
                    sub = data.subMap(toKey, true, fromKey, true);
                }
            } else if (hasFrom) {
                sub = data.tailMap(fromKey, true);
            } else if (hasTo) {
                sub = data.headMap(toKey, true);
            } else {
                sub = data;
            }

            int maxResults = (limit > 0) ? limit : 100;
            Map<String, byte[]> result = new LinkedHashMap<>();
            for (Map.Entry<String, byte[]> entry : sub.entrySet()) {
                if (result.size() >= maxResults) {
                    break;
                }
                result.put(entry.getKey(), entry.getValue().clone());
            }
            return result;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public Map<String, byte[]> getAll() {
        rwLock.readLock().lock();
        try {
            return new ConcurrentHashMap<>(data);
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
        rwLock.readLock().lock();
        try {
            File tempFile = new File(destinationFile.getParentFile(), destinationFile.getName() + ".tmp");
            try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(tempFile)))) {
                // Header
                out.writeInt(SNAPSHOT_MAGIC);
                out.writeLong(snapshotIndex);
                out.writeLong(snapshotTerm);

                // Key-Value data with versions
                out.writeInt(data.size());
                for (Map.Entry<String, byte[]> entry : data.entrySet()) {
                    byte[] keyBytes = entry.getKey().getBytes(StandardCharsets.UTF_8);
                    out.writeInt(keyBytes.length);
                    out.write(keyBytes);

                    byte[] valBytes = entry.getValue();
                    out.writeInt(valBytes.length);
                    out.write(valBytes);

                    long ver = versions.getOrDefault(entry.getKey(), 0L);
                    out.writeLong(ver);
                }

                // Session deduplication table
                out.writeInt(sessions.size());
                for (Map.Entry<String, SessionRecord> entry : sessions.entrySet()) {
                    byte[] clientBytes = entry.getKey().getBytes(StandardCharsets.UTF_8);
                    out.writeInt(clientBytes.length);
                    out.write(clientBytes);

                    SessionRecord rec = entry.getValue();
                    out.writeLong(rec.sequenceNumber());
                    out.writeInt(rec.lastResult().length);
                    out.write(rec.lastResult());
                    out.writeLong(rec.version());
                }

                out.flush();
            }

            Files.move(tempFile.toPath(), destinationFile.toPath(),
                    StandardCopyOption.REPLACE_EXISTING);

            log.info("Snapshot successfully created at {} with snapshotIndex={}, snapshotTerm={}, kvCount={}",
                    destinationFile.getAbsolutePath(), snapshotIndex, snapshotTerm, data.size());
        } finally {
            rwLock.readLock().unlock();
        }
    }

    @Override
    public void installSnapshot(File sourceFile) throws IOException {
        rwLock.writeLock().lock();
        try {
            if (!sourceFile.exists()) {
                throw new FileNotFoundException("Snapshot file not found: " + sourceFile.getAbsolutePath());
            }

            try (DataInputStream in = new DataInputStream(new BufferedInputStream(new FileInputStream(sourceFile)))) {
                int magic = in.readInt();
                if (magic != SNAPSHOT_MAGIC) {
                    throw new IOException("Invalid snapshot magic header: " + Integer.toHexString(magic));
                }

                long snapshotIndex = in.readLong();
                long snapshotTerm = in.readLong();

                // Clear current state
                data.clear();
                versions.clear();
                sessions.clear();

                // Read KV pairs
                int kvCount = in.readInt();
                for (int i = 0; i < kvCount; i++) {
                    int keyLen = in.readInt();
                    byte[] keyBytes = new byte[keyLen];
                    in.readFully(keyBytes);
                    String key = new String(keyBytes, StandardCharsets.UTF_8);

                    int valLen = in.readInt();
                    byte[] valBytes = new byte[valLen];
                    in.readFully(valBytes);

                    long ver = 0L;
                    // If stream still has available bytes for version or backward-compatible
                    try {
                        ver = in.readLong();
                    } catch (EOFException e) {
                        ver = 1L;
                    }

                    data.put(key, valBytes);
                    versions.put(key, ver);
                }

                // Read sessions
                if (in.available() > 0) {
                    int sessionCount = in.readInt();
                    for (int i = 0; i < sessionCount; i++) {
                        int clientLen = in.readInt();
                        byte[] clientBytes = new byte[clientLen];
                        in.readFully(clientBytes);
                        String client = new String(clientBytes, StandardCharsets.UTF_8);

                        long seqNum = in.readLong();
                        int resLen = in.readInt();
                        byte[] resBytes = new byte[resLen];
                        in.readFully(resBytes);

                        long ver = 0L;
                        if (in.available() >= 8) {
                            try {
                                ver = in.readLong();
                            } catch (EOFException ignored) {}
                        }

                        sessions.put(client, new SessionRecord(seqNum, resBytes, ver));
                    }
                }

                this.lastAppliedIndex = snapshotIndex;
                this.lastAppliedTerm = snapshotTerm;

                log.info("Installed snapshot from {}: snapshotIndex={}, snapshotTerm={}, kvCount={}",
                        sourceFile.getAbsolutePath(), snapshotIndex, snapshotTerm, data.size());
            }
        } finally {
            rwLock.writeLock().unlock();
        }
    }
}
