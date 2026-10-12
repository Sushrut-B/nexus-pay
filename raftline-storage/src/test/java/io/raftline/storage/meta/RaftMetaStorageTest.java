package io.raftline.storage.meta;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;

import static org.assertj.core.api.Assertions.assertThat;

class RaftMetaStorageTest {

    @Test
    void testSaveAndReload(@TempDir File tempDir) throws Exception {
        RaftMetaStorage storage = new RaftMetaStorage(tempDir);
        assertThat(storage.getCurrentTerm()).isEqualTo(0);
        assertThat(storage.getVotedFor()).isNull();

        storage.save(5, "node-2");
        assertThat(storage.getCurrentTerm()).isEqualTo(5);
        assertThat(storage.getVotedFor()).isEqualTo("node-2");

        // Reopen new instance from same directory
        RaftMetaStorage reloaded = new RaftMetaStorage(tempDir);
        assertThat(reloaded.getCurrentTerm()).isEqualTo(5);
        assertThat(reloaded.getVotedFor()).isEqualTo("node-2");

        // Update to new term
        reloaded.save(6, null);
        RaftMetaStorage reloaded2 = new RaftMetaStorage(tempDir);
        assertThat(reloaded2.getCurrentTerm()).isEqualTo(6);
        assertThat(reloaded2.getVotedFor()).isNull();
    }
}
