package io.raftline.core.shard;

import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Multi-Raft Group Manager co-locating multiple independent consensus groups on a single machine or process.
 * Routes keys to the designated group, manages group lifecycles, and executes operations.
 */
public class MultiRaftManager implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(MultiRaftManager.class);

    private final String localNodeId;
    private final ShardRouter router;
    private final Map<String, RaftNode> activeGroups = new ConcurrentHashMap<>();

    public MultiRaftManager(String localNodeId, ShardRouter router) {
        this.localNodeId = Objects.requireNonNull(localNodeId, "localNodeId");
        this.router = Objects.requireNonNull(router, "router");
    }

    public void registerGroup(String shardId, RaftNode node) {
        Objects.requireNonNull(shardId, "shardId");
        Objects.requireNonNull(node, "node");
        activeGroups.put(shardId, node);
        log.info("Node {} registered Raft group for shard {}", localNodeId, shardId);
    }

    public void unregisterGroup(String shardId) {
        RaftNode node = activeGroups.remove(shardId);
        if (node != null) {
            try {
                node.close();
            } catch (IOException e) {
                log.warn("Error closing node for shard {}", shardId, e);
            }
        }
    }

    public Optional<RaftNode> getGroup(String shardId) {
        return Optional.ofNullable(activeGroups.get(shardId));
    }

    public Map<String, RaftNode> getActiveGroups() {
        return Collections.unmodifiableMap(activeGroups);
    }

    public ShardRouter getRouter() {
        return router;
    }

    /**
     * Executes a command against the appropriate local shard group based on the command key.
     */
    public CompletableFuture<ApplyResult> execute(Command command) {
        Objects.requireNonNull(command, "command");
        Optional<ShardInfo> shardOpt = router.findShardForKey(command.getKey());
        if (shardOpt.isEmpty()) {
            CompletableFuture<ApplyResult> f = new CompletableFuture<>();
            f.completeExceptionally(new NoSuchElementException("No shard found covering key: " + command.getKey()));
            return f;
        }

        String shardId = shardOpt.get().shardId();
        RaftNode group = activeGroups.get(shardId);
        if (group == null) {
            CompletableFuture<ApplyResult> f = new CompletableFuture<>();
            f.completeExceptionally(new IllegalStateException("Local node " + localNodeId + " does not host replica for shard " + shardId));
            return f;
        }

        return group.execute(command);
    }

    /**
     * Performs a linearizable read by routing the key to the responsible local shard group.
     */
    public CompletableFuture<byte[]> readLinearizable(String key) {
        Objects.requireNonNull(key, "key");
        Optional<ShardInfo> shardOpt = router.findShardForKey(key);
        if (shardOpt.isEmpty()) {
            CompletableFuture<byte[]> f = new CompletableFuture<>();
            f.completeExceptionally(new NoSuchElementException("No shard found covering key: " + key));
            return f;
        }

        String shardId = shardOpt.get().shardId();
        RaftNode group = activeGroups.get(shardId);
        if (group == null) {
            CompletableFuture<byte[]> f = new CompletableFuture<>();
            f.completeExceptionally(new IllegalStateException("Local node " + localNodeId + " does not host replica for shard " + shardId));
            return f;
        }

        return group.readLinearizable(key);
    }

    /**
     * Performs a linearizable versioned read by routing the key to the responsible local shard group.
     */
    public CompletableFuture<io.raftline.storage.state.VersionedValue> readLinearizableVersioned(String key) {
        Objects.requireNonNull(key, "key");
        Optional<ShardInfo> shardOpt = router.findShardForKey(key);
        if (shardOpt.isEmpty()) {
            CompletableFuture<io.raftline.storage.state.VersionedValue> f = new CompletableFuture<>();
            f.completeExceptionally(new NoSuchElementException("No shard found covering key: " + key));
            return f;
        }

        String shardId = shardOpt.get().shardId();
        RaftNode group = activeGroups.get(shardId);
        if (group == null) {
            CompletableFuture<io.raftline.storage.state.VersionedValue> f = new CompletableFuture<>();
            f.completeExceptionally(new IllegalStateException("Local node " + localNodeId + " does not host replica for shard " + shardId));
            return f;
        }

        return group.readLinearizableVersioned(key);
    }

    @Override
    public synchronized void close() throws IOException {
        log.info("Closing MultiRaftManager on node {}", localNodeId);
        for (RaftNode node : activeGroups.values()) {
            try {
                node.close();
            } catch (Exception e) {
                log.warn("Error closing group node", e);
            }
        }
        activeGroups.clear();
    }
}
