package io.raftline.storage.meta;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Persists Raft consensus metadata atomically (currentTerm and votedFor) to disk.
 * Uses atomic file replacement (write temp file + sync + atomic rename) to prevent
 * corruption during sudden power loss or process kill.
 */
public class RaftMetaStorage {
    private static final Logger log = LoggerFactory.getLogger(RaftMetaStorage.class);
    private static final String META_FILE_NAME = "raft.meta";
    private static final String TEMP_META_FILE_NAME = "raft.meta.tmp";

    private final File dataDir;
    private final File metaFile;
    private final File tempMetaFile;
    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    private volatile long currentTerm = 0;
    private volatile String votedFor = null;

    public RaftMetaStorage(File dataDir) throws IOException {
        this.dataDir = Objects.requireNonNull(dataDir, "dataDir cannot be null");
        if (!dataDir.exists() && !dataDir.mkdirs()) {
            throw new IOException("Failed to create directory: " + dataDir.getAbsolutePath());
        }
        this.metaFile = new File(dataDir, META_FILE_NAME);
        this.tempMetaFile = new File(dataDir, TEMP_META_FILE_NAME);

        load();
    }

    private void load() throws IOException {
        rwLock.writeLock().lock();
        try {
            if (!metaFile.exists()) {
                log.info("No existing raft metadata found at {}. Initializing with term 0, votedFor null.", metaFile.getAbsolutePath());
                saveInternal(0, null);
                return;
            }

            byte[] bytes = Files.readAllBytes(metaFile.toPath());
            if (bytes.length < 8) {
                log.warn("Corrupt metadata file (< 8 bytes). Resetting term to 0.");
                saveInternal(0, null);
                return;
            }

            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            this.currentTerm = buffer.getLong();
            int votedForLen = buffer.getInt();
            if (votedForLen > 0 && buffer.remaining() >= votedForLen) {
                byte[] vfBytes = new byte[votedForLen];
                buffer.get(vfBytes);
                this.votedFor = new String(vfBytes, StandardCharsets.UTF_8);
            } else {
                this.votedFor = null;
            }

            log.info("Loaded Raft metadata: currentTerm={}, votedFor={}", currentTerm, votedFor);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Atomically saves the current term and vote to disk with fsync.
     */
    public void save(long term, String candidateId) throws IOException {
        rwLock.writeLock().lock();
        try {
            saveInternal(term, candidateId);
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    private void saveInternal(long term, String candidateId) throws IOException {
        byte[] vfBytes = (candidateId != null) ? candidateId.getBytes(StandardCharsets.UTF_8) : new byte[0];
        ByteBuffer buffer = ByteBuffer.allocate(8 + 4 + vfBytes.length);
        buffer.putLong(term);
        buffer.putInt(vfBytes.length);
        buffer.put(vfBytes);
        buffer.flip();

        // Write directly to metaFile with fsync (safe on Windows)
        try (FileChannel channel = FileChannel.open(
                metaFile.toPath(),
                StandardOpenOption.CREATE,
                StandardOpenOption.WRITE,
                StandardOpenOption.TRUNCATE_EXISTING)) {
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
            channel.force(true);
        }

        this.currentTerm = term;
        this.votedFor = candidateId;
    }

    public long getCurrentTerm() {
        return currentTerm;
    }

    public String getVotedFor() {
        return votedFor;
    }
}
