package io.raftline.storage.state;

import io.raftline.storage.model.Command;
import io.raftline.storage.model.LogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class KeyValueStoreTest {

    private KeyValueStore kvStore;

    @BeforeEach
    void setUp() {
        kvStore = new KeyValueStore();
    }

    @Test
    void testBasicPutGetDelete() {
        LogEntry put1 = new LogEntry(1, 1, Command.put("user:42", "Sushrut".getBytes(StandardCharsets.UTF_8), "c1", 1));
        ApplyResult res1 = kvStore.apply(put1);

        assertThat(res1.isSuccess()).isTrue();
        assertThat(kvStore.getLastAppliedIndex()).isEqualTo(1);
        assertThat(new String(kvStore.get("user:42"), StandardCharsets.UTF_8)).isEqualTo("Sushrut");

        // Delete
        LogEntry del = new LogEntry(2, 1, Command.delete("user:42", "c1", 2));
        ApplyResult res2 = kvStore.apply(del);
        assertThat(res2.isSuccess()).isTrue();
        assertThat(kvStore.get("user:42")).isNull();
    }

    @Test
    void testSessionIdempotency() {
        LogEntry put1 = new LogEntry(1, 1, Command.put("counter", "100".getBytes(StandardCharsets.UTF_8), "clientA", 1));
        ApplyResult res1 = kvStore.apply(put1);
        assertThat(res1.isSuccess()).isTrue();
        assertThat(res1.isDuplicate()).isFalse();

        // Simulate client retry with same client ID and sequence number
        LogEntry retry = new LogEntry(2, 1, Command.put("counter", "100".getBytes(StandardCharsets.UTF_8), "clientA", 1));
        ApplyResult resRetry = kvStore.apply(retry);
        assertThat(resRetry.isSuccess()).isTrue();
        assertThat(resRetry.isDuplicate()).isTrue();
        assertThat(new String(resRetry.getValue(), StandardCharsets.UTF_8)).isEqualTo("100");
    }

    @Test
    void testSnapshotAndRestore(@TempDir File tempDir) throws Exception {
        kvStore.apply(new LogEntry(1, 1, Command.put("k1", "v1".getBytes(StandardCharsets.UTF_8), "c1", 1)));
        kvStore.apply(new LogEntry(2, 1, Command.put("k2", "v2".getBytes(StandardCharsets.UTF_8), "c1", 2)));

        File snapshotFile = new File(tempDir, "snapshot.bin");
        kvStore.takeSnapshot(snapshotFile, 2, 1);
        assertThat(snapshotFile).exists();

        // New empty store restores from snapshot
        KeyValueStore restoredStore = new KeyValueStore();
        restoredStore.installSnapshot(snapshotFile);

        assertThat(restoredStore.getLastAppliedIndex()).isEqualTo(2);
        assertThat(restoredStore.getLastAppliedTerm()).isEqualTo(1);
        assertThat(new String(restoredStore.get("k1"), StandardCharsets.UTF_8)).isEqualTo("v1");
        assertThat(new String(restoredStore.get("k2"), StandardCharsets.UTF_8)).isEqualTo("v2");

        // Verify session deduplication table was preserved across snapshot
        LogEntry retryK2 = new LogEntry(3, 2, Command.put("k2", "v2".getBytes(StandardCharsets.UTF_8), "c1", 2));
        ApplyResult res = restoredStore.apply(retryK2);
        assertThat(res.isDuplicate()).isTrue();
    }
}
