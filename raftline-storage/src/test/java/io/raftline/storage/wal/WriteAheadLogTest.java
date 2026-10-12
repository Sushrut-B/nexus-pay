package io.raftline.storage.wal;

import io.raftline.storage.model.Command;
import io.raftline.storage.model.LogEntry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class WriteAheadLogTest {

    @TempDir
    File tempDir;

    private WriteAheadLog wal;

    @BeforeEach
    void setUp() throws Exception {
        wal = new WriteAheadLog(tempDir);
    }

    @AfterEach
    void tearDown() throws Exception {
        if (wal != null) {
            wal.close();
        }
    }

    @Test
    void testAppendAndRead() throws Exception {
        Command cmd1 = Command.put("user:1", "Alice".getBytes(StandardCharsets.UTF_8), "c1", 1);
        LogEntry entry1 = new LogEntry(1, 1, cmd1);

        Command cmd2 = Command.put("user:2", "Bob".getBytes(StandardCharsets.UTF_8), "c1", 2);
        LogEntry entry2 = new LogEntry(2, 1, cmd2);

        wal.append(entry1);
        wal.append(entry2);

        assertThat(wal.getLastLogIndex()).isEqualTo(2);
        assertThat(wal.getLastLogTerm()).isEqualTo(1);

        LogEntry read1 = wal.getEntry(1);
        assertThat(read1).isNotNull();
        assertThat(read1.getIndex()).isEqualTo(1);
        assertThat(read1.getTerm()).isEqualTo(1);
        assertThat(read1.getCommand().getKey()).isEqualTo("user:1");

        List<LogEntry> range = wal.getEntriesFrom(1, 10);
        assertThat(range).hasSize(2);
        assertThat(range.get(0).getCommand().getKey()).isEqualTo("user:1");
        assertThat(range.get(1).getCommand().getKey()).isEqualTo("user:2");
    }

    @Test
    void testReopenAndCrashRecovery() throws Exception {
        Command cmd1 = Command.put("key1", "val1".getBytes(StandardCharsets.UTF_8), "c1", 1);
        wal.append(new LogEntry(1, 1, cmd1));

        Command cmd2 = Command.put("key2", "val2".getBytes(StandardCharsets.UTF_8), "c1", 2);
        wal.append(new LogEntry(2, 1, cmd2));

        wal.close();

        // Simulate crash with partial / torn write at end of WAL
        File walFile = new File(tempDir, "raft.wal");
        try (RandomAccessFile raf = new RandomAccessFile(walFile, "rw")) {
            raf.seek(raf.length());
            // Write 5 garbage bytes simulating an incomplete frame header
            raf.write(new byte[]{0x11, 0x22, 0x33, 0x44, 0x55});
        }

        // Reopen WAL - should safely detect torn tail and truncate it
        wal = new WriteAheadLog(tempDir);
        assertThat(wal.getLastLogIndex()).isEqualTo(2);
        assertThat(wal.getEntry(1).getCommand().getKey()).isEqualTo("key1");
        assertThat(wal.getEntry(2).getCommand().getKey()).isEqualTo("key2");

        // Should be able to append new entry at index 3 seamlessly
        Command cmd3 = Command.put("key3", "val3".getBytes(StandardCharsets.UTF_8), "c1", 3);
        wal.append(new LogEntry(3, 2, cmd3));
        assertThat(wal.getLastLogIndex()).isEqualTo(3);
    }

    @Test
    void testTruncateSuffix() throws Exception {
        wal.append(new LogEntry(1, 1, Command.put("k1", "v1".getBytes(StandardCharsets.UTF_8), "c1", 1)));
        wal.append(new LogEntry(2, 1, Command.put("k2", "v2".getBytes(StandardCharsets.UTF_8), "c1", 2)));
        wal.append(new LogEntry(3, 1, Command.put("k3", "v3".getBytes(StandardCharsets.UTF_8), "c1", 3)));

        assertThat(wal.getLastLogIndex()).isEqualTo(3);

        // Truncate from index 2 onwards (Raft uncommitted rollback)
        wal.truncateSuffix(2);
        assertThat(wal.getLastLogIndex()).isEqualTo(1);
        assertThat(wal.getEntry(2)).isNull();
        assertThat(wal.getEntry(3)).isNull();

        // Reopen to verify truncation was durable on disk
        wal.close();
        wal = new WriteAheadLog(tempDir);
        assertThat(wal.getLastLogIndex()).isEqualTo(1);

        // Append new conflicting entry at index 2 with term 2
        wal.append(new LogEntry(2, 2, Command.put("k2_new", "v2_new".getBytes(StandardCharsets.UTF_8), "c1", 4)));
        assertThat(wal.getLastLogIndex()).isEqualTo(2);
        assertThat(wal.getEntry(2).getTerm()).isEqualTo(2);
        assertThat(wal.getEntry(2).getCommand().getKey()).isEqualTo("k2_new");
    }
}
