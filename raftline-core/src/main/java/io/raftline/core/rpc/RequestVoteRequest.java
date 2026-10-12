package io.raftline.core.rpc;

public record RequestVoteRequest(
        long term,
        String candidateId,
        long lastLogIndex,
        long lastLogTerm
) {}
