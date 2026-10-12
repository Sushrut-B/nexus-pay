package io.raftline.core.rpc;

import java.util.Arrays;
import java.util.Objects;

public final class InstallSnapshotRequest {
    private final long term;
    private final String leaderId;
    private final long lastIncludedIndex;
    private final long lastIncludedTerm;
    private final byte[] data;
    private final boolean done;

    public InstallSnapshotRequest(long term, String leaderId, long lastIncludedIndex, long lastIncludedTerm, byte[] data, boolean done) {
        this.term = term;
        this.leaderId = Objects.requireNonNull(leaderId, "leaderId cannot be null");
        this.lastIncludedIndex = lastIncludedIndex;
        this.lastIncludedTerm = lastIncludedTerm;
        this.data = data != null ? data : new byte[0];
        this.done = done;
    }

    public long term() { return term; }
    public String leaderId() { return leaderId; }
    public long lastIncludedIndex() { return lastIncludedIndex; }
    public long lastIncludedTerm() { return lastIncludedTerm; }
    public byte[] data() { return data; }
    public boolean done() { return done; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        InstallSnapshotRequest that = (InstallSnapshotRequest) o;
        return term == that.term &&
                lastIncludedIndex == that.lastIncludedIndex &&
                lastIncludedTerm == that.lastIncludedTerm &&
                done == that.done &&
                Objects.equals(leaderId, that.leaderId) &&
                Arrays.equals(data, that.data);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(term, leaderId, lastIncludedIndex, lastIncludedTerm, done);
        result = 31 * result + Arrays.hashCode(data);
        return result;
    }
}
