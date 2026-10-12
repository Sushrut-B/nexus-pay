package io.raftline.core.config;

import java.util.Collections;
import java.util.List;
import java.util.Objects;

public class RaftConfig {
    private final String localNodeId;
    private final List<String> peerIds;
    private final long minElectionTimeoutMs;
    private final long maxElectionTimeoutMs;
    private final long heartbeatIntervalMs;
    private final int maxEntriesPerAppend;
    private final long snapshotThresholdCount;

    public RaftConfig(String localNodeId, List<String> peerIds) {
        this(localNodeId, peerIds, 300, 750, 50, 500, 1000);
    }

    public RaftConfig(String localNodeId, List<String> peerIds,
                      long minElectionTimeoutMs, long maxElectionTimeoutMs,
                      long heartbeatIntervalMs, int maxEntriesPerAppend,
                      long snapshotThresholdCount) {
        this.localNodeId = Objects.requireNonNull(localNodeId, "localNodeId cannot be null");
        this.peerIds = Collections.unmodifiableList(peerIds != null ? peerIds : Collections.emptyList());
        this.minElectionTimeoutMs = minElectionTimeoutMs;
        this.maxElectionTimeoutMs = maxElectionTimeoutMs;
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.maxEntriesPerAppend = maxEntriesPerAppend;
        this.snapshotThresholdCount = snapshotThresholdCount;
    }

    public String getLocalNodeId() {
        return localNodeId;
    }

    public List<String> getPeerIds() {
        return peerIds;
    }

    public int getClusterSize() {
        return peerIds.size() + 1; // peers + self
    }

    public int getQuorum() {
        return (getClusterSize() / 2) + 1;
    }

    public long getMinElectionTimeoutMs() {
        return minElectionTimeoutMs;
    }

    public long getMaxElectionTimeoutMs() {
        return maxElectionTimeoutMs;
    }

    public long getHeartbeatIntervalMs() {
        return heartbeatIntervalMs;
    }

    public int getMaxEntriesPerAppend() {
        return maxEntriesPerAppend;
    }

    public long getSnapshotThresholdCount() {
        return snapshotThresholdCount;
    }
}
