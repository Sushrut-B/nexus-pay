package io.raftline.core.shard;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Shard router that maintains cluster range mappings, routes keys to their corresponding shard,
 * and dynamically splits / rebalances shard boundaries.
 */
public class ShardRouter {
    private final Map<String, ShardInfo> shards = new ConcurrentHashMap<>();

    public ShardRouter() {}

    public ShardRouter(Collection<ShardInfo> initialShards) {
        if (initialShards != null) {
            for (ShardInfo shard : initialShards) {
                registerShard(shard);
            }
        }
    }

    public void registerShard(ShardInfo shard) {
        Objects.requireNonNull(shard, "shard");
        shards.put(shard.shardId(), shard);
    }

    public void unregisterShard(String shardId) {
        shards.remove(shardId);
    }

    public Optional<ShardInfo> findShardForKey(String key) {
        Objects.requireNonNull(key, "key");
        for (ShardInfo shard : shards.values()) {
            if (shard.containsKey(key)) {
                return Optional.of(shard);
            }
        }
        return Optional.empty();
    }

    public Optional<ShardInfo> getShard(String shardId) {
        return Optional.ofNullable(shards.get(shardId));
    }

    public List<ShardInfo> getAllShards() {
        return new ArrayList<>(shards.values());
    }

    /**
     * Dynamically splits a shard at the given splitKey into two new child shards.
     * The original shard is replaced by two child shards:
     * - newLeftShardId: [origStartKey, splitKey)
     * - newRightShardId: [splitKey, origEndKey)
     *
     * @param originalShardId The existing shard ID to split
     * @param splitKey The boundary key inside the existing shard range
     * @param newLeftShardId ID of the lower half shard
     * @param newRightShardId ID of the upper half shard
     * @param leftReplicas Replicas assigned to the left shard (optional, defaults to original replicas)
     * @param rightReplicas Replicas assigned to the right shard (optional, defaults to original replicas)
     * @return Array of the two new ShardInfo instances [left, right]
     */
    public synchronized ShardInfo[] splitShard(String originalShardId, String splitKey,
                                              String newLeftShardId, String newRightShardId,
                                              List<String> leftReplicas, List<String> rightReplicas) {
        ShardInfo original = shards.get(originalShardId);
        if (original == null) {
            throw new NoSuchElementException("Original shard not found: " + originalShardId);
        }

        KeyRange[] splitRanges = original.range().split(splitKey);
        List<String> replicasLeft = (leftReplicas != null && !leftReplicas.isEmpty()) ? leftReplicas : original.replicaNodeIds();
        List<String> replicasRight = (rightReplicas != null && !rightReplicas.isEmpty()) ? rightReplicas : original.replicaNodeIds();

        ShardInfo leftShard = new ShardInfo(newLeftShardId, splitRanges[0], replicasLeft);
        ShardInfo rightShard = new ShardInfo(newRightShardId, splitRanges[1], replicasRight);

        // Atomic replacement: remove original, add new halves
        shards.remove(originalShardId);
        shards.put(newLeftShardId, leftShard);
        shards.put(newRightShardId, rightShard);

        return new ShardInfo[] { leftShard, rightShard };
    }

    /**
     * Rebalances replica placements for a shard.
     */
    public synchronized ShardInfo rebalanceShard(String shardId, List<String> newReplicas) {
        ShardInfo original = shards.get(shardId);
        if (original == null) {
            throw new NoSuchElementException("Shard not found for rebalancing: " + shardId);
        }
        ShardInfo updated = new ShardInfo(shardId, original.range(), newReplicas);
        shards.put(shardId, updated);
        return updated;
    }
}
