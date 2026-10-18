package io.raftline.testkit;

import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.config.RaftConfig;
import io.raftline.core.shard.KeyRange;
import io.raftline.core.shard.MultiRaftManager;
import io.raftline.core.shard.ShardInfo;
import io.raftline.core.shard.ShardRouter;
import io.raftline.core.transport.RaftRpcHandler;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;

class MultiRaftShardingTest {

    private final List<RaftNode> allCreatedNodes = new ArrayList<>();
    private final List<MultiRaftManager> managers = new ArrayList<>();
    private ExecutorService networkExecutor;

    @AfterEach
    void tearDown() throws Exception {
        for (RaftNode node : allCreatedNodes) {
            try {
                node.close();
            } catch (Exception ignored) {}
        }
        for (MultiRaftManager mgr : managers) {
            try {
                mgr.close();
            } catch (Exception ignored) {}
        }
        if (networkExecutor != null) {
            networkExecutor.shutdownNow();
        }
    }

    @Test
    void testMultiRaftKeyRangeRoutingAndConvergence(@TempDir File tempDir) throws Exception {
        networkExecutor = Executors.newFixedThreadPool(8);
        Map<String, RaftRpcHandler> clusterHandlers = new ConcurrentHashMap<>();
        Set<String> disconnectedPairs = ConcurrentHashMap.newKeySet();

        // Define 2 shards:
        // Shard-A: ["a", "m")
        // Shard-B: ["m", "z")
        ShardInfo shardA = new ShardInfo("shard-a", new KeyRange("a", "m"), List.of("node-1", "node-2", "node-3"));
        ShardInfo shardB = new ShardInfo("shard-b", new KeyRange("m", "z"), List.of("node-1", "node-2", "node-3"));

        ShardRouter router = new ShardRouter(List.of(shardA, shardB));

        // Create 3 physical nodes (node-1, node-2, node-3), each hosting a group for shard-A and shard-B
        Map<String, MultiRaftManager> nodeManagers = new HashMap<>();

        for (int i = 1; i <= 3; i++) {
            String nodeId = "node-" + i;
            MultiRaftManager mgr = new MultiRaftManager(nodeId, router);
            managers.add(mgr);
            nodeManagers.put(nodeId, mgr);

            // Create Raft group for Shard-A
            String groupAId = nodeId + "-shard-a";
            List<String> peersA = List.of("node-1-shard-a", "node-2-shard-a", "node-3-shard-a").stream()
                    .filter(id -> !id.equals(groupAId))
                    .toList();
            RaftNode groupANode = createGroupNode(tempDir, groupAId, peersA, clusterHandlers, disconnectedPairs);
            mgr.registerGroup("shard-a", groupANode);

            // Create Raft group for Shard-B
            String groupBId = nodeId + "-shard-b";
            List<String> peersB = List.of("node-1-shard-b", "node-2-shard-b", "node-3-shard-b").stream()
                    .filter(id -> !id.equals(groupBId))
                    .toList();
            RaftNode groupBNode = createGroupNode(tempDir, groupBId, peersB, clusterHandlers, disconnectedPairs);
            mgr.registerGroup("shard-b", groupBNode);
        }

        // Wait for both shards to elect leaders
        RaftNode leaderShardA = waitForLeader(List.of("node-1-shard-a", "node-2-shard-a", "node-3-shard-a"));
        RaftNode leaderShardB = waitForLeader(List.of("node-1-shard-b", "node-2-shard-b", "node-3-shard-b"));

        assertThat(leaderShardA).isNotNull();
        assertThat(leaderShardB).isNotNull();

        // 1. Write key routed to Shard-A: "customer:42" -> falls into ["a", "m")
        Command cmdA = Command.put("customer:42", "Alice".getBytes(StandardCharsets.UTF_8), "c1", 1);
        ApplyResult resA = leaderShardA.execute(cmdA).get(3, TimeUnit.SECONDS);
        assertThat(resA.isSuccess()).isTrue();

        // 2. Write key routed to Shard-B: "order:99" -> falls into ["m", "z")
        Command cmdB = Command.put("order:99", "Delivered".getBytes(StandardCharsets.UTF_8), "c1", 2);
        ApplyResult resB = leaderShardB.execute(cmdB).get(3, TimeUnit.SECONDS);
        assertThat(resB.isSuccess()).isTrue();

        Thread.sleep(150);

        // Verify ShardRouter correctness
        assertThat(router.findShardForKey("customer:42").orElseThrow().shardId()).isEqualTo("shard-a");
        assertThat(router.findShardForKey("order:99").orElseThrow().shardId()).isEqualTo("shard-b");

        // Verify independent state machines for Shard-A contain "customer:42" and NOT "order:99"
        for (String id : List.of("node-1-shard-a", "node-2-shard-a", "node-3-shard-a")) {
            RaftNode node = findNodeById(id);
            byte[] val = node.getStateMachine().get("customer:42");
            assertThat(val).isNotNull();
            assertThat(new String(val, StandardCharsets.UTF_8)).isEqualTo("Alice");
            assertThat(node.getStateMachine().get("order:99")).isNull();
        }

        // Verify independent state machines for Shard-B contain "order:99" and NOT "customer:42"
        for (String id : List.of("node-1-shard-b", "node-2-shard-b", "node-3-shard-b")) {
            RaftNode node = findNodeById(id);
            byte[] val = node.getStateMachine().get("order:99");
            assertThat(val).isNotNull();
            assertThat(new String(val, StandardCharsets.UTF_8)).isEqualTo("Delivered");
            assertThat(node.getStateMachine().get("customer:42")).isNull();
        }
    }

    @Test
    void testDynamicShardSplitAndRebalancing() {
        // Setup initial single shard covering entire keyspace: ["", "")
        ShardInfo initialShard = new ShardInfo("shard-root", KeyRange.UNBOUNDED, List.of("node-1", "node-2", "node-3"));
        ShardRouter router = new ShardRouter(List.of(initialShard));

        // Initial lookup routes any key to root shard
        assertThat(router.findShardForKey("user:100").orElseThrow().shardId()).isEqualTo("shard-root");
        assertThat(router.findShardForKey("order:500").orElseThrow().shardId()).isEqualTo("shard-root");

        // Dynamically split "shard-root" at boundary "m" -> ["", "m") and ["m", "")
        ShardInfo[] splitResult = router.splitShard(
                "shard-root", "m",
                "shard-low", "shard-high",
                List.of("node-1", "node-2", "node-3"),
                List.of("node-2", "node-3", "node-4")
        );

        assertThat(splitResult).hasSize(2);
        assertThat(splitResult[0].shardId()).isEqualTo("shard-low");
        assertThat(splitResult[0].range().startKey()).isEqualTo("");
        assertThat(splitResult[0].range().endKey()).isEqualTo("m");

        assertThat(splitResult[1].shardId()).isEqualTo("shard-high");
        assertThat(splitResult[1].range().startKey()).isEqualTo("m");
        assertThat(splitResult[1].range().endKey()).isEqualTo("");

        // Original root shard is removed
        assertThat(router.getShard("shard-root")).isEmpty();

        // Key routing now routes precisely across the split boundary
        assertThat(router.findShardForKey("apple").orElseThrow().shardId()).isEqualTo("shard-low");
        assertThat(router.findShardForKey("customer:1").orElseThrow().shardId()).isEqualTo("shard-low");
        assertThat(router.findShardForKey("music").orElseThrow().shardId()).isEqualTo("shard-high");
        assertThat(router.findShardForKey("zebra").orElseThrow().shardId()).isEqualTo("shard-high");

        // Rebalance shard-low to new replica set: [node-3, node-4, node-5]
        ShardInfo rebalanced = router.rebalanceShard("shard-low", List.of("node-3", "node-4", "node-5"));
        assertThat(rebalanced.replicaNodeIds()).containsExactly("node-3", "node-4", "node-5");
        assertThat(router.getShard("shard-low").orElseThrow().replicaNodeIds()).containsExactly("node-3", "node-4", "node-5");
    }

    @Test
    void testTwoPhaseCommitCrossShardAtomicTransaction(@TempDir File tempDir) throws Exception {
        networkExecutor = Executors.newFixedThreadPool(8);
        Map<String, RaftRpcHandler> clusterHandlers = new ConcurrentHashMap<>();
        Set<String> disconnectedPairs = ConcurrentHashMap.newKeySet();

        ShardInfo shardA = new ShardInfo("shard-a", new KeyRange("a", "m"), List.of("node-1", "node-2", "node-3"));
        ShardInfo shardB = new ShardInfo("shard-b", new KeyRange("m", "z"), List.of("node-1", "node-2", "node-3"));
        ShardRouter router = new ShardRouter(List.of(shardA, shardB));

        MultiRaftManager mgr1 = new MultiRaftManager("node-1", router);
        managers.add(mgr1);

        // Group A on node-1
        RaftNode groupA = createGroupNode(tempDir, "node-1-shard-a", Collections.emptyList(), clusterHandlers, disconnectedPairs);
        mgr1.registerGroup("shard-a", groupA);

        // Group B on node-1
        RaftNode groupB = createGroupNode(tempDir, "node-1-shard-b", Collections.emptyList(), clusterHandlers, disconnectedPairs);
        mgr1.registerGroup("shard-b", groupB);

        // Wait for elections
        waitForLeader(List.of("node-1-shard-a"));
        waitForLeader(List.of("node-1-shard-b"));

        io.raftline.core.shard.txn.TwoPhaseCommitCoordinator coordinator =
                new io.raftline.core.shard.txn.TwoPhaseCommitCoordinator(mgr1);

        // Multi-shard transaction updating key in shard-a ("account:alice") and key in shard-b ("user:bob")
        Map<String, byte[]> writes = Map.of(
                "account:alice", "balance=1000".getBytes(StandardCharsets.UTF_8),
                "user:bob", "balance=500".getBytes(StandardCharsets.UTF_8)
        );

        boolean committed = coordinator.executeTransaction(writes).get(3, TimeUnit.SECONDS);
        assertThat(committed).isTrue();

        Thread.sleep(100);

        // Assert both state machines applied writes atomically
        byte[] aliceVal = groupA.getStateMachine().get("account:alice");
        byte[] bobVal = groupB.getStateMachine().get("user:bob");

        assertThat(aliceVal).isNotNull();
        assertThat(new String(aliceVal, StandardCharsets.UTF_8)).isEqualTo("balance=1000");

        assertThat(bobVal).isNotNull();
        assertThat(new String(bobVal, StandardCharsets.UTF_8)).isEqualTo("balance=500");
    }

    private RaftNode createGroupNode(File baseDir, String nodeId, List<String> peers,
                                     Map<String, RaftRpcHandler> clusterHandlers,
                                     Set<String> disconnectedPairs) throws Exception {
        File nodeDir = new File(baseDir, nodeId);
        nodeDir.mkdirs();
        RaftConfig config = new RaftConfig(nodeId, peers, 80, 160, 25, 100, 1000);
        WriteAheadLog wal = new WriteAheadLog(nodeDir, false);
        RaftMetaStorage meta = new RaftMetaStorage(nodeDir);
        KeyValueStore kv = new KeyValueStore();
        InProcessRaftTransport transport = new InProcessRaftTransport(nodeId, clusterHandlers, disconnectedPairs, networkExecutor);
        RaftNode node = new RaftNode(config, wal, meta, kv, transport);
        allCreatedNodes.add(node);
        node.start();
        return node;
    }

    private RaftNode waitForLeader(List<String> nodeIds) throws Exception {
        long deadline = System.currentTimeMillis() + 3000;
        while (System.currentTimeMillis() < deadline) {
            for (String id : nodeIds) {
                RaftNode n = findNodeById(id);
                if (n != null && n.getRole() == Role.LEADER) {
                    return n;
                }
            }
            Thread.sleep(20);
        }
        throw new TimeoutException("Leader election timeout for group " + nodeIds);
    }

    private RaftNode findNodeById(String id) {
        for (RaftNode n : allCreatedNodes) {
            if (n.getNodeId().equals(id)) return n;
        }
        return null;
    }
}
