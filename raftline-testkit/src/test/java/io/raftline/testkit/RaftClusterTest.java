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
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

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
}
