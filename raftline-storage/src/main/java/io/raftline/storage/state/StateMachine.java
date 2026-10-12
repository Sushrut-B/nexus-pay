package io.raftline.storage.state;

import io.raftline.storage.model.LogEntry;

import java.io.File;
import java.io.IOException;

/**
 * Replicated State Machine interface.
 * Committed commands are applied sequentially in deterministic order.
 */
public interface StateMachine {

    /**
     * Applies a committed log entry to the state machine.
     * Updates the last applied index.
     */
    ApplyResult apply(LogEntry entry);

    /**
     * Reads a value by key.
     */
    byte[] get(String key);

    /**
     * Scans a range of keys [fromKey, toKey] up to limit entries in lexicographical order.
     */
    java.util.Map<String, byte[]> scan(String fromKey, String toKey, int limit);

    /**
     * The index of the highest log entry applied to the state machine so far.
     */
    long getLastAppliedIndex();

    /**
     * The term of the highest log entry applied to the state machine so far.
     */
    long getLastAppliedTerm();

    /**
     * Writes a complete, consistent snapshot of the state machine to disk.
     */
    void takeSnapshot(File destinationFile, long snapshotIndex, long snapshotTerm) throws IOException;

    /**
     * Restores state machine state entirely from a snapshot file (e.g. from InstallSnapshot).
     */
    void installSnapshot(File sourceFile) throws IOException;
}
