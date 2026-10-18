package io.raftline.core.shard;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Shard router that maintains cluster range mappings and routes keys to their corresponding shard.
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
}
