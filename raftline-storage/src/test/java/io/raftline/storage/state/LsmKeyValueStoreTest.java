package io.raftline.storage.state;

import io.raftline.storage.model.Command;
import io.raftline.storage.model.LogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class LsmKeyValueStoreTest {

    @TempDir
    File tempDir;

    private LsmKeyValueStore store;

    @BeforeEach
    void setUp() throws Exception {
        // Small threshold to force MemTable flushes to SSTables
        store = new LsmKeyValueStore(tempDir, 128);
    }

    @Test
    void testPutGetAndRangeScan() throws Exception {
        store.apply(new LogEntry(1, 1, Command.put("user:01", "Alice".getBytes(StandardCharsets.UTF_8))));
        store.apply(new LogEntry(2, 1, Command.put("user:02", "Bob".getBytes(StandardCharsets.UTF_8))));
        store.apply(new LogEntry(3, 1, Command.put("user:03", "Charlie".getBytes(StandardCharsets.UTF_8))));
        store.apply(new LogEntry(4, 1, Command.put("user:04", "David".getBytes(StandardCharsets.UTF_8))));

        // Force a flush to SSTable
        store.flushMemTableToDisk();

        // Point lookups
        byte[] v1 = store.get("user:01");
        assertThat(new String(v1, StandardCharsets.UTF_8)).isEqualTo("Alice");

        byte[] v3 = store.get("user:03");
        assertThat(new String(v3, StandardCharsets.UTF_8)).isEqualTo("Charlie");

        // Range scan [user:02, user:04]
        Map<String, byte[]> scanResult = store.scan("user:02", "user:04", 10);
        assertThat(scanResult).containsOnlyKeys("user:02", "user:03", "user:04");
        assertThat(new String(scanResult.get("user:02"), StandardCharsets.UTF_8)).isEqualTo("Bob");
    }

    @Test
    void testTombstoneDeletion() throws Exception {
        store.apply(new LogEntry(1, 1, Command.put("user:delete_me", "Active".getBytes(StandardCharsets.UTF_8))));
        store.flushMemTableToDisk();

        assertThat(store.get("user:delete_me")).isNotNull();

        // Apply DELETE tombstone
        store.apply(new LogEntry(2, 1, Command.delete("user:delete_me")));
        assertThat(store.get("user:delete_me")).isNull();

        // Flush tombstone to SSTable and verify it stays deleted
        store.flushMemTableToDisk();
        assertThat(store.get("user:delete_me")).isNull();
    }

    @Test
    void testSnapshotPersistenceAndRestore() throws Exception {
        store.apply(new LogEntry(1, 1, Command.put("key1", "val1".getBytes(StandardCharsets.UTF_8))));
        store.apply(new LogEntry(2, 1, Command.put("key2", "val2".getBytes(StandardCharsets.UTF_8))));

        File snapFile = new File(tempDir, "lsm_snapshot.bin");
        store.takeSnapshot(snapFile, 2, 1);

        File restoreDir = new File(tempDir, "restore");
        LsmKeyValueStore restoredStore = new LsmKeyValueStore(restoreDir);
        restoredStore.installSnapshot(snapFile);

        assertThat(restoredStore.getLastAppliedIndex()).isEqualTo(2);
        assertThat(restoredStore.getLastAppliedTerm()).isEqualTo(1);
        assertThat(new String(restoredStore.get("key1"), StandardCharsets.UTF_8)).isEqualTo("val1");
        assertThat(new String(restoredStore.get("key2"), StandardCharsets.UTF_8)).isEqualTo("val2");
    }
}
