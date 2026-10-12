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
import java.util.*;
import java.util.concurrent.ConcurrentNavigableMap;
import java.util.concurrent.ConcurrentSkipListMap;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Enterprise Segmented Write-Ahead Log (WAL) with:
 * - CRC32 binary framed records: [CRC:4][Length:4][Payload:N]
 * - Multi-segment file rolling (segment-00000000000000000001.wal, etc.)
 * - Automatic segment rotation when file exceeds maxSegmentSizeBytes
 * - Prefix garbage collection: automatically deletes sealed segments covered by snapshots
 * - Suffix truncation (§5.3): rolls back conflicting uncommitted follower logs
 * - Crash recovery: auto-detects torn writes and trims partial tail bytes
 */
public class WriteAheadLog implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(WriteAheadLog.class);
    private static final String LEGACY_LOG_FILE = "raft.wal";
    public static final long DEFAULT_MAX_SEGMENT_BYTES = 16 * 1024 * 1024; // 16 MB

    private final File logDir;
    private final boolean syncOnAppend;
    private final long maxSegmentSizeBytes;

    private final ReentrantReadWriteLock rwLock = new ReentrantReadWriteLock();

    // Map: segmentStartIndex -> WalSegment
    private final ConcurrentNavigableMap<Long, WalSegment> segments = new ConcurrentSkipListMap<>();
    private volatile WalSegment activeSegment;

    // In-memory index: maps logIndex -> LogEntry
    private final ConcurrentNavigableMap<Long, LogEntry> entryIndex = new ConcurrentSkipListMap<>();
    // Maps logIndex -> SegmentPointer (which segment and what offset)
    private final ConcurrentNavigableMap<Long, SegmentPointer> pointerIndex = new ConcurrentSkipListMap<>();

    private volatile long snapshotIndex = 0;
    private volatile long snapshotTerm = 0;

    public static record SegmentPointer(long segmentStartIndex, long offset) {}

    public WriteAheadLog(File logDir) throws IOException {
        this(logDir, true, DEFAULT_MAX_SEGMENT_BYTES);
    }

    public WriteAheadLog(File logDir, boolean syncOnAppend) throws IOException {
        this(logDir, syncOnAppend, DEFAULT_MAX_SEGMENT_BYTES);
    }

    public WriteAheadLog(File logDir, boolean syncOnAppend, long maxSegmentSizeBytes) throws IOException {
        this.logDir = logDir;
        this.syncOnAppend = syncOnAppend;
        this.maxSegmentSizeBytes = maxSegmentSizeBytes > 0 ? maxSegmentSizeBytes : DEFAULT_MAX_SEGMENT_BYTES;

        if (!logDir.exists() && !logDir.mkdirs()) {
            throw new IOException("Failed to create WAL directory: " + logDir.getAbsolutePath());
        }

        openAndRecover();
    }

    private void openAndRecover() throws IOException {
        rwLock.writeLock().lock();
        try {
            // Check for legacy raft.wal and migrate to segment format
            File legacyFile = new File(logDir, LEGACY_LOG_FILE);
            if (legacyFile.exists() && legacyFile.length() > 0) {
                File firstSegment = new File(logDir, formatSegmentFileName(1));
                if (!firstSegment.exists()) {
                    boolean renamed = legacyFile.renameTo(firstSegment);
                    if (renamed) {
                        log.info("Migrated legacy raft.wal to {}", firstSegment.getName());
                    }
                }
            }

            // Find all segment files
            File[] segmentFiles = logDir.listFiles((dir, name) -> name.startsWith("segment-") && name.endsWith(".wal"));
            List<File> sortedFiles = new ArrayList<>();
            if (segmentFiles != null && segmentFiles.length > 0) {
                sortedFiles.addAll(Arrays.asList(segmentFiles));
                sortedFiles.sort(Comparator.comparing(File::getName));
            }

            if (sortedFiles.isEmpty()) {
                // Initialize fresh first segment
                File firstSegFile = new File(logDir, formatSegmentFileName(1));
                WalSegment firstSeg = new WalSegment(firstSegFile, 1);
                segments.put(1L, firstSeg);
                activeSegment = firstSeg;
                log.info("Initialized fresh WAL with active segment {}", firstSegFile.getName());
                return;
            }

            // Recover existing segments in chronological order
            for (File segFile : sortedFiles) {
                long startIdx = parseStartIndexFromFileName(segFile.getName());
                WalSegment seg = new WalSegment(segFile, startIdx);
                recoverSegment(seg);
                segments.put(startIdx, seg);
            }

            activeSegment = segments.lastEntry().getValue();
            log.info("Segmented WAL recovery complete. Active segment: {} (total segments: {}). Recovered {} entries. LastIndex={}, LastTerm={}",
                    activeSegment.getFile().getName(), segments.size(), entryIndex.size(), getLastLogIndex(), getLastLogTerm());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    private void recoverSegment(WalSegment seg) throws IOException {
        FileChannel channel = seg.getChannel();
        long fileSize = channel.size();
        if (fileSize == 0) return;

        long currentOffset = 0;
        ByteBuffer headerBuffer = ByteBuffer.allocate(8);

        while (currentOffset + 8 <= fileSize) {
            headerBuffer.clear();
            channel.position(currentOffset);
            int read = channel.read(headerBuffer);
            if (read < 8) break;

            headerBuffer.flip();
            int expectedCrc = headerBuffer.getInt();
            int payloadLength = headerBuffer.getInt();

            if (payloadLength <= 0 || currentOffset + 8 + payloadLength > fileSize) {
                break;
            }

            ByteBuffer fullFrameBuffer = ByteBuffer.allocate(8 + payloadLength);
            fullFrameBuffer.putInt(expectedCrc);
            fullFrameBuffer.putInt(payloadLength);

            ByteBuffer payloadBuffer = ByteBuffer.allocate(payloadLength);
            channel.read(payloadBuffer);
            payloadBuffer.flip();
            fullFrameBuffer.put(payloadBuffer);
            fullFrameBuffer.flip();

            try {
                LogEntry entry = LogEntry.deserialize(fullFrameBuffer);
                entryIndex.put(entry.getIndex(), entry);
                pointerIndex.put(entry.getIndex(), new SegmentPointer(seg.getStartIndex(), currentOffset));
                seg.updateEndIndex(entry.getIndex());
                currentOffset += (8 + payloadLength);
            } catch (Exception e) {
                log.warn("Corrupt frame at offset {} in {}: {}", currentOffset, seg.getFile().getName(), e.getMessage());
                break;
            }
        }

        // Auto-trim trailing torn writes
        if (currentOffset < fileSize) {
            log.warn("Truncating torn write in {} from {} to {}", seg.getFile().getName(), fileSize, currentOffset);
            channel.truncate(currentOffset);
            if (syncOnAppend) {
                channel.force(true);
            }
        }
    }

    public void append(LogEntry entry) throws IOException {
        append(Collections.singletonList(entry));
    }

    public void append(List<LogEntry> entries) throws IOException {
        if (entries == null || entries.isEmpty()) return;

        rwLock.writeLock().lock();
        try {
            for (LogEntry entry : entries) {
                long expectedIndex = getLastLogIndex() + 1;
                if (entry.getIndex() != expectedIndex) {
                    throw new IllegalArgumentException(
                            "Non-consecutive log index: expected " + expectedIndex + " but got " + entry.getIndex());
                }

                // Check if active segment has exceeded maxSegmentSizeBytes
                if (activeSegment.getChannel().size() >= maxSegmentSizeBytes) {
                    rollSegment(entry.getIndex());
                }

                FileChannel channel = activeSegment.getChannel();
                long currentOffset = channel.size();
                channel.position(currentOffset);

                byte[] serialized = entry.serialize();
                ByteBuffer buffer = ByteBuffer.wrap(serialized);
                while (buffer.hasRemaining()) {
                    channel.write(buffer);
                }

                entryIndex.put(entry.getIndex(), entry);
                pointerIndex.put(entry.getIndex(), new SegmentPointer(activeSegment.getStartIndex(), currentOffset));
                activeSegment.updateEndIndex(entry.getIndex());
            }

            if (syncOnAppend) {
                activeSegment.getChannel().force(false);
            }
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    private void rollSegment(long newStartIndex) throws IOException {
        // Force and seal current active segment
        activeSegment.getChannel().force(true);
        log.info("Sealing WAL segment {} at endIndex={}", activeSegment.getFile().getName(), activeSegment.getEndIndex());

        File newSegFile = new File(logDir, formatSegmentFileName(newStartIndex));
        WalSegment newSeg = new WalSegment(newSegFile, newStartIndex);
        segments.put(newStartIndex, newSeg);
        activeSegment = newSeg;
        log.info("Rolled to new active WAL segment {} (startIndex={})", newSegFile.getName(), newStartIndex);
    }

    public LogEntry getEntry(long index) {
        rwLock.readLock().lock();
        try {
            return entryIndex.get(index);
        } finally {
            rwLock.readLock().unlock();
        }
    }

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

    public void truncateSuffix(long fromIndex) throws IOException {
        rwLock.writeLock().lock();
        try {
            if (fromIndex > getLastLogIndex()) return;
            if (fromIndex <= snapshotIndex) {
                throw new IllegalStateException("Cannot truncate committed snapshot entries at index <= " + snapshotIndex);
            }

            SegmentPointer ptr = pointerIndex.get(fromIndex);
            long segStart = (ptr != null) ? ptr.segmentStartIndex() : activeSegment.getStartIndex();

            // Delete any newer segments completely after this segment
            List<Long> toRemove = new ArrayList<>();
            for (Map.Entry<Long, WalSegment> e : segments.tailMap(segStart, false).entrySet()) {
                e.getValue().close();
                e.getValue().getFile().delete();
                toRemove.add(e.getKey());
            }
            for (Long sKey : toRemove) {
                segments.remove(sKey);
            }

            // Truncate the segment containing fromIndex
            WalSegment targetSeg = segments.get(segStart);
            if (targetSeg != null) {
                long offset = (ptr != null) ? ptr.offset() : 0;
                targetSeg.getChannel().truncate(offset);
                if (syncOnAppend) {
                    targetSeg.getChannel().force(true);
                }
                targetSeg.updateEndIndex(fromIndex - 1);
                activeSegment = targetSeg;
            }

            // Erase entries from in-memory index
            entryIndex.tailMap(fromIndex, true).clear();
            pointerIndex.tailMap(fromIndex, true).clear();

            log.info("Truncated WAL suffix from index {}. New LastIndex={}", fromIndex, getLastLogIndex());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    public void setSnapshotBoundary(long snapshotIndex, long snapshotTerm) {
        rwLock.writeLock().lock();
        try {
            this.snapshotIndex = snapshotIndex;
            this.snapshotTerm = snapshotTerm;

            // Clear compacted entries from memory
            entryIndex.headMap(snapshotIndex + 1, false).clear();
            pointerIndex.headMap(snapshotIndex + 1, false).clear();

            // Garbage collect sealed segments on disk
            garbageCollectSegments(snapshotIndex);

            log.info("WAL updated snapshot boundary: snapshotIndex={}, snapshotTerm={}. In-memory log starts from {}",
                    snapshotIndex, snapshotTerm, getFirstLogIndex());
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    private void garbageCollectSegments(long upToSnapshotIndex) {
        List<Long> toDelete = new ArrayList<>();
        for (Map.Entry<Long, WalSegment> e : segments.entrySet()) {
            WalSegment seg = e.getValue();
            // Never delete active segment!
            if (seg == activeSegment) continue;

            if (seg.getEndIndex() > 0 && seg.getEndIndex() <= upToSnapshotIndex) {
                try {
                    seg.close();
                    boolean deleted = seg.getFile().delete();
                    if (deleted) {
                        toDelete.add(e.getKey());
                        log.info("Garbage collected sealed WAL segment {} (endIndex={} <= snapshotIndex={})",
                                seg.getFile().getName(), seg.getEndIndex(), upToSnapshotIndex);
                    }
                } catch (IOException ex) {
                    log.error("Failed to delete sealed segment {}", seg.getFile().getName(), ex);
                }
            }
        }
        for (Long k : toDelete) {
            segments.remove(k);
        }
    }

    public long getFirstLogIndex() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) return snapshotIndex + 1;
            return entryIndex.firstKey();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getLastLogIndex() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) return snapshotIndex;
            return entryIndex.lastKey();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getLastLogTerm() {
        rwLock.readLock().lock();
        try {
            if (entryIndex.isEmpty()) return snapshotTerm;
            LogEntry lastEntry = entryIndex.lastEntry().getValue();
            return lastEntry != null ? lastEntry.getTerm() : snapshotTerm;
        } finally {
            rwLock.readLock().unlock();
        }
    }

    public long getTermForIndex(long index) {
        rwLock.readLock().lock();
        try {
            if (index == 0) return 0;
            if (index == snapshotIndex) return snapshotTerm;
            LogEntry entry = entryIndex.get(index);
            return entry != null ? entry.getTerm() : 0;
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

    public int getSegmentCount() {
        rwLock.readLock().lock();
        try {
            return segments.size();
        } finally {
            rwLock.readLock().unlock();
        }
    }

    private static String formatSegmentFileName(long startIndex) {
        return String.format("segment-%020d.wal", startIndex);
    }

    private static long parseStartIndexFromFileName(String name) {
        try {
            String numStr = name.substring("segment-".length(), name.length() - ".wal".length());
            return Long.parseLong(numStr);
        } catch (Exception e) {
            return 1L;
        }
    }

    @Override
    public void close() throws IOException {
        rwLock.writeLock().lock();
        try {
            for (WalSegment seg : segments.values()) {
                seg.close();
            }
            segments.clear();
            entryIndex.clear();
            pointerIndex.clear();
        } finally {
            rwLock.writeLock().unlock();
        }
    }

    /**
     * Managed physical WAL Segment file wrapper.
     */
    public static class WalSegment implements Closeable {
        private final File file;
        private final long startIndex;
        private RandomAccessFile raf;
        private FileChannel channel;
        private volatile long endIndex;

        public WalSegment(File file, long startIndex) throws IOException {
            this.file = file;
            this.startIndex = startIndex;
            this.raf = new RandomAccessFile(file, "rw");
            this.channel = raf.getChannel();
            this.endIndex = startIndex - 1;
        }

        public File getFile() {
            return file;
        }

        public long getStartIndex() {
            return startIndex;
        }

        public long getEndIndex() {
            return endIndex;
        }

        public void updateEndIndex(long index) {
            this.endIndex = Math.max(this.endIndex, index);
        }

        public FileChannel getChannel() {
            return channel;
        }

        @Override
        public void close() throws IOException {
            if (channel != null && channel.isOpen()) {
                channel.close();
            }
            if (raf != null) {
                raf.close();
            }
        }
    }
}
