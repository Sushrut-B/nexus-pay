package io.raftline.core.rpc;

public record AppendEntriesResponse(
        long term,
        boolean success,
        long matchIndex
) {}
