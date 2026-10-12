package io.raftline.core.rpc;

import io.raftline.storage.model.LogEntry;

import java.util.Collections;
import java.util.List;

public record AppendEntriesRequest(
        long term,
        String leaderId,
        long prevLogIndex,
        long prevLogTerm,
        List<LogEntry> entries,
        long leaderCommit
) {
    public AppendEntriesRequest {
        entries = (entries != null) ? Collections.unmodifiableList(entries) : Collections.emptyList();
    }
}
