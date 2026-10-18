package io.raftline.core.shard;

import java.util.List;
import java.util.Objects;

/**
 * Metadata descriptor for a shard / range group in a Multi-Raft cluster.
 */
public record ShardInfo(
        String shardId,
        KeyRange range,
        List<String> replicaNodeIds
) {
    public ShardInfo {
        Objects.requireNonNull(shardId, "shardId");
        Objects.requireNonNull(range, "range");
        Objects.requireNonNull(replicaNodeIds, "replicaNodeIds");
    }

    public boolean containsKey(String key) {
        return range.contains(key);
    }
}
