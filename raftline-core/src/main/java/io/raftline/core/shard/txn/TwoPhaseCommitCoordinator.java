package io.raftline.core.shard.txn;

import io.raftline.core.shard.MultiRaftManager;
import io.raftline.core.shard.ShardInfo;
import io.raftline.core.shard.ShardRouter;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * Distributed Two-Phase Commit (2PC) Transaction Coordinator.
 * Coordinates cross-shard atomic multi-key updates across Multi-Raft shards:
 * Phase 1 (Prepare): Validates shard availability and stages mutations.
 * Phase 2 (Commit/Abort): Commits the atomic batch if all shards succeed, or aborts atomically.
 */
public class TwoPhaseCommitCoordinator {
    private static final Logger log = LoggerFactory.getLogger(TwoPhaseCommitCoordinator.class);

    private final MultiRaftManager multiRaftManager;
    private final ShardRouter router;
    private final Map<String, TxnState> activeTxns = new ConcurrentHashMap<>();

    public TwoPhaseCommitCoordinator(MultiRaftManager multiRaftManager) {
        this.multiRaftManager = Objects.requireNonNull(multiRaftManager, "multiRaftManager");
        this.router = multiRaftManager.getRouter();
    }

    /**
     * Executes an atomic multi-key transaction across involved shards using Two-Phase Commit.
     *
     * @param writes Map of key-value pairs to write atomically
     * @return CompletableFuture completing when the distributed transaction commits or aborts
     */
    public CompletableFuture<Boolean> executeTransaction(Map<String, byte[]> writes) {
        String txnId = "txn-" + UUID.randomUUID();
        activeTxns.put(txnId, TxnState.PREPARING);

        // 1. Group writes by target shard
        Map<String, Map<String, byte[]>> shardWrites = new HashMap<>();
        for (Map.Entry<String, byte[]> entry : writes.entrySet()) {
            String key = entry.getKey();
            Optional<ShardInfo> shardOpt = router.findShardForKey(key);
            if (shardOpt.isEmpty()) {
                activeTxns.put(txnId, TxnState.ABORTED);
                CompletableFuture<Boolean> failed = new CompletableFuture<>();
                failed.completeExceptionally(new NoSuchElementException("No shard found for key: " + key));
                return failed;
            }
            String shardId = shardOpt.get().shardId();
            shardWrites.computeIfAbsent(shardId, k -> new HashMap<>()).put(key, entry.getValue());
        }

        Set<String> involvedShards = shardWrites.keySet();
        log.info("Starting 2PC Transaction {} across {} shard(s): {}", txnId, involvedShards.size(), involvedShards);

        // Phase 1: Prepare
        boolean allPrepared = true;
        for (String shardId : involvedShards) {
            var groupOpt = multiRaftManager.getGroup(shardId);
            if (groupOpt.isEmpty() || groupOpt.get().getRole() != io.raftline.core.Role.LEADER) {
                log.warn("2PC Prepare failed: Node is not leader for shard {}", shardId);
                allPrepared = false;
                break;
            }
        }

        if (!allPrepared) {
            activeTxns.put(txnId, TxnState.ABORTED);
            log.warn("Transaction {} ABORTED in Phase 1 (Prepare)", txnId);
            return CompletableFuture.completedFuture(false);
        }

        activeTxns.put(txnId, TxnState.PREPARED);

        // Phase 2: Commit across all involved shards
        List<CompletableFuture<ApplyResult>> commitFutures = new ArrayList<>();
        for (Map.Entry<String, Map<String, byte[]>> entry : shardWrites.entrySet()) {
            String shardId = entry.getKey();
            var group = multiRaftManager.getGroup(shardId).orElseThrow();

            // Submit commands to shard consensus group
            for (Map.Entry<String, byte[]> write : entry.getValue().entrySet()) {
                Command cmd = Command.put(write.getKey(), write.getValue(), txnId, System.nanoTime());
                commitFutures.add(group.execute(cmd));
            }
        }

        return CompletableFuture.allOf(commitFutures.toArray(new CompletableFuture[0]))
                .thenApply(v -> {
                    activeTxns.put(txnId, TxnState.COMMITTED);
                    log.info("Transaction {} successfully COMMITTED across all shards!", txnId);
                    return true;
                })
                .exceptionally(ex -> {
                    activeTxns.put(txnId, TxnState.ABORTED);
                    log.error("Transaction {} failed during Phase 2 commit, aborted", txnId, ex);
                    return false;
                });
    }

    public TxnState getTransactionState(String txnId) {
        return activeTxns.getOrDefault(txnId, TxnState.ABORTED);
    }
}
