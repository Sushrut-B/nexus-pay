package io.raftline.core;

public class NotLeaderException extends RuntimeException {
    private final String leaderHint;

    public NotLeaderException(String leaderHint) {
        super("Node is not the leader. Leader hint: " + (leaderHint != null ? leaderHint : "unknown"));
        this.leaderHint = leaderHint;
    }

    public String getLeaderHint() {
        return leaderHint;
    }
}
