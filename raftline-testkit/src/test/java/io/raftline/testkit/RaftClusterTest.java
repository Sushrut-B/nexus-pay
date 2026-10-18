package io.raftline.testkit;

import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;

class RaftClusterTest {

    private ClusterSimulator cluster;

    @AfterEach
    void tearDown() throws Exception {
        if (cluster != null) {
            cluster.close();
        }
    }

    @Test
    void testLeaderElectionInFiveNodeCluster(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);

        // Wait for leader election
        RaftNode leader = cluster.waitForLeader(3000);
        assertThat(leader).isNotNull();
        assertThat(leader.getRole()).isEqualTo(Role.LEADER);
        assertThat(leader.getCurrentTerm()).isGreaterThanOrEqualTo(1);

        // Verify only 1 leader exists
        long leaderCount = cluster.getNodes().values().stream()
                .filter(n -> n.getRole() == Role.LEADER)
                .count();
        assertThat(leaderCount).isEqualTo(1);
    }

    @Test
    void testReplicationAndStateConvergence(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);

        // Write command to leader: PUT user:42 "Sushrut"
        Command cmd = Command.put("user:42", "Sushrut".getBytes(StandardCharsets.UTF_8), "client-1", 1);
        CompletableFuture<ApplyResult> future = leader.execute(cmd);

        ApplyResult result = future.get(3, TimeUnit.SECONDS);
        assertThat(result.isSuccess()).isTrue();

        // Allow brief heartbeat round for followers to advance commit index
        Thread.sleep(150);

        // Verify all 5 nodes have converged state
        for (String nodeId : cluster.getNodes().keySet()) {
            byte[] value = cluster.getStateMachine(nodeId).get("user:42");
            assertThat(value)
                    .as("Node %s must have user:42", nodeId)
                    .isNotNull();
            assertThat(new String(value, StandardCharsets.UTF_8)).isEqualTo("Sushrut");
        }
    }

    @Test
    void testLeaderCrashAndRecovery(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader1 = cluster.waitForLeader(3000);
        String oldLeaderId = leader1.getNodeId();

        // Write before crash
        Command cmd1 = Command.put("key1", "val1".getBytes(StandardCharsets.UTF_8), "c1", 1);
        leader1.execute(cmd1).get(2, TimeUnit.SECONDS);

        // Kill current leader!
        cluster.killNode(oldLeaderId);

        // A new leader must be elected by the remaining 4 nodes
        RaftNode leader2 = cluster.waitForLeader(3000);
        assertThat(leader2.getNodeId()).isNotEqualTo(oldLeaderId);
        assertThat(leader2.getRole()).isEqualTo(Role.LEADER);

        // Write to new leader
        Command cmd2 = Command.put("key2", "val2".getBytes(StandardCharsets.UTF_8), "c1", 2);
        leader2.execute(cmd2).get(2, TimeUnit.SECONDS);

        // Restart old crashed leader
        cluster.restartNode(oldLeaderId);
        Thread.sleep(250);

        // Old crashed node should catch up with both key1 and key2!
        byte[] v1 = cluster.getStateMachine(oldLeaderId).get("key1");
        byte[] v2 = cluster.getStateMachine(oldLeaderId).get("key2");

        assertThat(v1).isNotNull();
        assertThat(new String(v1, StandardCharsets.UTF_8)).isEqualTo("val1");
        assertThat(v2).isNotNull();
        assertThat(new String(v2, StandardCharsets.UTF_8)).isEqualTo("val2");
    }

    @Test
    void testNetworkPartitionMajorityVsMinority(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);

        // Create network partition: {node-1, node-2} vs {node-3, node-4, node-5}
        Set<String> minority = Set.of("node-1", "node-2");
        Set<String> majority = Set.of("node-3", "node-4", "node-5");
        cluster.partition(minority, majority);

        // Wait for election to stabilize in majority
        Thread.sleep(400);

        // Find leader in majority partition
        RaftNode majorityLeader = null;
        for (String id : majority) {
            RaftNode node = cluster.getNodes().get(id);
            if (node != null && node.getRole() == Role.LEADER) {
                majorityLeader = node;
                break;
            }
        }
        assertThat(majorityLeader).isNotNull();

        // Writes to majority partition succeed because quorum is 3 out of 5
        Command cmd = Command.put("partition-test", "success".getBytes(StandardCharsets.UTF_8), "c1", 1);
        ApplyResult res = majorityLeader.execute(cmd).get(3, TimeUnit.SECONDS);
        assertThat(res.isSuccess()).isTrue();

        // Heal partition
        cluster.healPartition();
        Thread.sleep(300);

        // Minority nodes must catch up!
        for (String id : minority) {
            byte[] val = cluster.getStateMachine(id).get("partition-test");
            assertThat(val).isNotNull();
            assertThat(new String(val, StandardCharsets.UTF_8)).isEqualTo("success");
        }
    }

    @Test
    void testLeaderLeaseLinearizableReads(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);

        // Populate key via leader
        Command cmd = Command.put("lease-key", "lease-val".getBytes(StandardCharsets.UTF_8), "c1", 1);
        leader.execute(cmd).get(3, TimeUnit.SECONDS);

        // Wait a brief moment for heartbeats to refresh lease
        Thread.sleep(100);

        // Verify leader lease is valid
        assertThat(leader.isLeaderLeaseValid()).isTrue();

        // Linearizable read should return lease value immediately
        byte[] readVal = leader.readLinearizable("lease-key").get(1, TimeUnit.SECONDS);
        assertThat(readVal).isNotNull();
        assertThat(new String(readVal, StandardCharsets.UTF_8)).isEqualTo("lease-val");

        // Linearizable range scan should also return immediately
        Map<String, byte[]> scanResult = leader.scanLinearizable("lease-", "lease-z", 10).get(1, TimeUnit.SECONDS);
        assertThat(scanResult).containsKey("lease-key");
        assertThat(new String(scanResult.get("lease-key"), StandardCharsets.UTF_8)).isEqualTo("lease-val");
    }

    @Test
    void testBatchExecutionAndStateConvergence(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);

        // Prepare batch of 10 commands
        List<Command> batch = new java.util.ArrayList<>();
        for (int i = 1; i <= 10; i++) {
            batch.add(Command.put("batch-k" + i, ("batch-v" + i).getBytes(StandardCharsets.UTF_8), "c1", 100 + i));
        }

        // Execute entire batch atomically
        List<ApplyResult> results = leader.executeBatch(batch).get(5, TimeUnit.SECONDS);
        assertThat(results).hasSize(10);
        for (ApplyResult r : results) {
            assertThat(r.isSuccess()).isTrue();
        }

        // Allow brief heartbeat round for followers
        Thread.sleep(150);

        // Verify all 5 nodes have converged on all 10 keys
        for (String nodeId : cluster.getNodes().keySet()) {
            for (int i = 1; i <= 10; i++) {
                byte[] v = cluster.getStateMachine(nodeId).get("batch-k" + i);
                assertThat(v)
                        .as("Node %s must have batch-k%d", nodeId, i)
                        .isNotNull();
                assertThat(new String(v, StandardCharsets.UTF_8)).isEqualTo("batch-v" + i);
            }
        }
    }

    @Test
    void testPipelinedReplicationCatchup(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);

        // Disconnect node-5 temporarily
        cluster.killNode("node-5");

        // Write 30 entries while node-5 is down
        for (int i = 1; i <= 30; i++) {
            Command cmd = Command.put("pipe-k" + i, ("pipe-v" + i).getBytes(StandardCharsets.UTF_8), "c1", 200 + i);
            leader.execute(cmd).get(3, TimeUnit.SECONDS);
        }

        // Restart node-5
        cluster.restartNode("node-5");

        // Allow pipelined fast catch-up to stream entries
        Thread.sleep(300);

        // Verify node-5 quickly caught up with all 30 entries
        for (int i = 1; i <= 30; i++) {
            byte[] v = cluster.getStateMachine("node-5").get("pipe-k" + i);
            assertThat(v)
                    .as("node-5 must catch up pipe-k%d", i)
                    .isNotNull();
            assertThat(new String(v, StandardCharsets.UTF_8)).isEqualTo("pipe-v" + i);
        }
    }

    @Test
    void testAsymmetricalNetworkPartitionResiliency(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode leader = cluster.waitForLeader(3000);
        String leaderId = leader.getNodeId();

        // Pick one follower
        String followerId = cluster.getNodes().keySet().stream()
                .filter(id -> !id.equals(leaderId))
                .findFirst()
                .orElseThrow();

        // Create asymmetric partition: leader cannot send to followerId, but followerId CAN send to leader
        cluster.isolateDirection(leaderId, followerId);

        // Leader writes command - should still succeed because quorum (3 out of 5) is met with other 3 followers!
        Command cmd = Command.put("asym-key", "asym-val".getBytes(StandardCharsets.UTF_8), "c1", 301);
        ApplyResult result = leader.execute(cmd).get(3, TimeUnit.SECONDS);
        assertThat(result.isSuccess()).isTrue();

        // Heal directed partition
        cluster.healDirection(leaderId, followerId);
        Thread.sleep(250);

        // The follower should now receive heartbeats/appends and converge
        byte[] val = cluster.getStateMachine(followerId).get("asym-key");
        assertThat(val).isNotNull();
        assertThat(new String(val, StandardCharsets.UTF_8)).isEqualTo("asym-val");
    }

    @Test
    void testMinorityPartitionSplitBrainProtection(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 5);
        RaftNode initialLeader = cluster.waitForLeader(3000);
        String oldLeaderId = initialLeader.getNodeId();

        // Partition the old leader + 1 follower into minority {node-A, node-B}
        // vs majority {node-C, node-D, node-E}
        List<String> allNodes = new java.util.ArrayList<>(cluster.getNodes().keySet());
        allNodes.remove(oldLeaderId);
        String minorityFollower = allNodes.remove(0);

        Set<String> minority = Set.of(oldLeaderId, minorityFollower);
        Set<String> majority = new java.util.HashSet<>(allNodes);

        cluster.partition(minority, majority);

        // Allow election in majority
        Thread.sleep(400);

        // A write attempted on the minority partition cannot achieve quorum
        Command failedCmd = Command.put("isolated-key", "should-fail".getBytes(StandardCharsets.UTF_8), "c1", 401);
        CompletableFuture<ApplyResult> minorityFuture = initialLeader.execute(failedCmd);

        // Verify that the minority cannot commit within 800ms
        org.junit.jupiter.api.Assertions.assertThrows(TimeoutException.class, () -> {
            minorityFuture.get(800, TimeUnit.MILLISECONDS);
        });

        // The majority partition must elect a leader and successfully commit writes
        RaftNode majorityLeader = null;
        for (String id : majority) {
            RaftNode n = cluster.getNodes().get(id);
            if (n != null && n.getRole() == Role.LEADER) {
                majorityLeader = n;
                break;
            }
        }
        assertThat(majorityLeader).isNotNull();

        Command successCmd = Command.put("isolated-key", "committed-in-majority".getBytes(StandardCharsets.UTF_8), "c1", 402);
        ApplyResult majorityResult = majorityLeader.execute(successCmd).get(3, TimeUnit.SECONDS);
        assertThat(majorityResult.isSuccess()).isTrue();

        // Heal partition
        cluster.healPartition();
        Thread.sleep(350);

        // Verify all 5 nodes have converged on the majority's committed value, NOT the abandoned minority write
        for (String nodeId : cluster.getNodes().keySet()) {
            byte[] v = cluster.getStateMachine(nodeId).get("isolated-key");
            assertThat(v).isNotNull();
            assertThat(new String(v, StandardCharsets.UTF_8)).isEqualTo("committed-in-majority");
        }
    }
}

