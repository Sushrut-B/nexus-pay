package io.raftline.core.rpc;

public record RequestVoteResponse(
        long term,
        boolean voteGranted
) {}
