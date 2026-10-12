package io.raftline.core.config;

import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.CopyOnWriteArrayList;

public class RaftConfig {
    private final String localNodeId;
    private final CopyOnWriteArrayList<String> peerIds;
    private final long minElectionTimeoutMs;
    private final long maxElectionTimeoutMs;
    private final long heartbeatIntervalMs;
    private final int maxEntriesPerAppend;
    private final long snapshotThresholdCount;
    private final boolean preVoteEnabled;
    private final boolean leaderLeaseEnabled;
    private final long leaderLeaseDurationMs;

    public RaftConfig(String localNodeId, List<String> peerIds) {
        this(localNodeId, peerIds, 300, 750, 50, 500, 1000, true);
    }

    public RaftConfig(String localNodeId, List<String> peerIds,
                      long minElectionTimeoutMs, long maxElectionTimeoutMs,
                      long heartbeatIntervalMs, int maxEntriesPerAppend,
                      long snapshotThresholdCount) {
        this(localNodeId, peerIds, minElectionTimeoutMs, maxElectionTimeoutMs,
                heartbeatIntervalMs, maxEntriesPerAppend, snapshotThresholdCount, true);
    }

    public RaftConfig(String localNodeId, List<String> peerIds,
                      long minElectionTimeoutMs, long maxElectionTimeoutMs,
                      long heartbeatIntervalMs, int maxEntriesPerAppend,
                      long snapshotThresholdCount, boolean preVoteEnabled) {
        this(localNodeId, peerIds, minElectionTimeoutMs, maxElectionTimeoutMs,
                heartbeatIntervalMs, maxEntriesPerAppend, snapshotThresholdCount, preVoteEnabled,
                true, minElectionTimeoutMs / 2);
    }

    public RaftConfig(String localNodeId, List<String> peerIds,
                      long minElectionTimeoutMs, long maxElectionTimeoutMs,
                      long heartbeatIntervalMs, int maxEntriesPerAppend,
                      long snapshotThresholdCount, boolean preVoteEnabled,
                      boolean leaderLeaseEnabled, long leaderLeaseDurationMs) {
        this.localNodeId = Objects.requireNonNull(localNodeId, "localNodeId cannot be null");
        this.peerIds = new CopyOnWriteArrayList<>(peerIds != null ? peerIds : Collections.emptyList());
        this.minElectionTimeoutMs = minElectionTimeoutMs;
        this.maxElectionTimeoutMs = maxElectionTimeoutMs;
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.maxEntriesPerAppend = maxEntriesPerAppend;
        this.snapshotThresholdCount = snapshotThresholdCount;
        this.preVoteEnabled = preVoteEnabled;
        this.leaderLeaseEnabled = leaderLeaseEnabled;
        this.leaderLeaseDurationMs = leaderLeaseDurationMs;
    }

    public String getLocalNodeId() {
        return localNodeId;
    }

    public List<String> getPeerIds() {
        return Collections.unmodifiableList(peerIds);
    }

    public boolean addPeer(String peerId) {
        if (peerId == null || peerId.equals(localNodeId) || peerIds.contains(peerId)) {
            return false;
        }
        return peerIds.add(peerId);
    }

    public boolean removePeer(String peerId) {
        return peerIds.remove(peerId);
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

    public boolean isPreVoteEnabled() {
        return preVoteEnabled;
    }

    public boolean isLeaderLeaseEnabled() {
        return leaderLeaseEnabled;
    }

    public long getLeaderLeaseDurationMs() {
        return leaderLeaseDurationMs;
    }
}
