package io.raftline.core.rpc;

public record RequestVoteRequest(
        long term,
        String candidateId,
        long lastLogIndex,
        long lastLogTerm,
        boolean isPreVote
) {
    public RequestVoteRequest(long term, String candidateId, long lastLogIndex, long lastLogTerm) {
        this(term, candidateId, lastLogIndex, lastLogTerm, false);
    }
}
