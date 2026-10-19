package io.raftline.api;

import io.raftline.client.QuorixClient;
import io.raftline.core.RaftNode;
import io.raftline.core.agent.AgentLockInfo;
import io.raftline.core.config.RaftConfig;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import io.raftline.transport.GrpcRaftTransport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

public class AgentLockManagerIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private QuorixClient client;

    @AfterEach
    void tearDown() {
        if (client != null) client.close();
        for (RaftHttpServer s : httpServers) s.close();
        for (RaftNode nd : nodes) {
            try { nd.close(); } catch (Exception ignored) {}
        }
    }

    @Test
    void testDistributedAgentLockWithMonotonicFencingTokens(@TempDir File tempDir) throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8941,
                "node-2", 8942,
                "node-3", 8943
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9941,
                "node-2", 9942,
                "node-3", 9943
        );

        List<String> seedHttpUrls = new ArrayList<>();

        for (String id : nodeIds) {
            File nDir = new File(tempDir, id);
            nDir.mkdirs();

            List<String> peers = new ArrayList<>(nodeIds);
            peers.remove(id);

            Map<String, String> grpcAddrs = new HashMap<>();
            for (String p : peers) {
                grpcAddrs.put(p, "127.0.0.1:" + grpcPorts.get(p));
            }

            RaftConfig cfg = new RaftConfig(id, peers, 80, 160, 25, 100, 1000);
            WriteAheadLog wal = new WriteAheadLog(nDir, false);
            RaftMetaStorage meta = new RaftMetaStorage(nDir);
            KeyValueStore fsm = new KeyValueStore();
            GrpcRaftTransport transport = new GrpcRaftTransport(id, grpcPorts.get(id), grpcAddrs);

            RaftNode node = new RaftNode(cfg, wal, meta, fsm, transport);
            nodes.add(node);
            node.start();

            RaftHttpServer server = new RaftHttpServer(httpPorts.get(id), node, httpPorts);
            httpServers.add(server);
            server.start();

            seedHttpUrls.add("http://127.0.0.1:" + httpPorts.get(id));
        }

        // Wait for leader election
        RaftNode leader = null;
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            for (RaftNode nd : nodes) {
                if (nd.getRole() == io.raftline.core.Role.LEADER) {
                    leader = nd;
                    break;
                }
            }
            if (leader != null) break;
            Thread.sleep(100);
        }
        assertThat(leader).isNotNull();

        int leaderHttpPort = httpPorts.get(leader.getNodeId());
        String leaderUrl = "http://127.0.0.1:" + leaderHttpPort;
        client = QuorixClient.create(seedHttpUrls.toArray(new String[0]));

        String resource = "tool:financial_trade_execution";
        String agentA = "agent-alpha-7";
        String agentB = "agent-beta-9";

        // 1. Agent A acquires the lock
        AgentLockInfo lockA = client.acquireAgentLock(leaderUrl, resource, agentA, 5000);
        assertThat(lockA).isNotNull();
        assertThat(lockA.getResource()).isEqualTo(resource);
        assertThat(lockA.getOwnerAgentId()).isEqualTo(agentA);
        assertThat(lockA.getFencingToken()).isGreaterThan(0L);
        long tokenA = lockA.getFencingToken();

        // 2. Query lock state via GET
        AgentLockInfo queried = client.getAgentLock(leaderUrl, resource);
        assertThat(queried).isNotNull();
        assertThat(queried.getOwnerAgentId()).isEqualTo(agentA);
        assertThat(queried.getFencingToken()).isEqualTo(tokenA);

        // 3. Agent B attempts to acquire while lock is held -> must fail (return null)
        AgentLockInfo lockBConflict = client.acquireAgentLock(leaderUrl, resource, agentB, 5000);
        assertThat(lockBConflict).isNull();

        // 4. Agent A renews the lock
        AgentLockInfo renewedA = client.renewAgentLock(leaderUrl, resource, agentA, tokenA, 8000);
        assertThat(renewedA).isNotNull();
        assertThat(renewedA.getFencingToken()).isEqualTo(tokenA);
        assertThat(renewedA.getExpiresAtEpochMs()).isGreaterThan(lockA.getExpiresAtEpochMs());

        // 5. Agent B attempts to renew or release Agent A's lock -> must be rejected
        AgentLockInfo forgedRenew = client.renewAgentLock(leaderUrl, resource, agentB, tokenA, 5000);
        assertThat(forgedRenew).isNull();

        boolean forgedRelease = client.releaseAgentLock(leaderUrl, resource, agentB, tokenA);
        assertThat(forgedRelease).isFalse();

        // 6. Agent A cleanly releases lock
        boolean released = client.releaseAgentLock(leaderUrl, resource, agentA, tokenA);
        assertThat(released).isTrue();

        // 7. Agent B can now acquire the lock, and MUST receive a strictly monotonically higher fencing token
        AgentLockInfo lockB = client.acquireAgentLock(leaderUrl, resource, agentB, 5000);
        assertThat(lockB).isNotNull();
        assertThat(lockB.getOwnerAgentId()).isEqualTo(agentB);
        assertThat(lockB.getFencingToken()).isGreaterThan(tokenA);

        // 8. Agent A cannot use stale token tokenA anymore
        boolean staleRelease = client.releaseAgentLock(leaderUrl, resource, agentA, tokenA);
        assertThat(staleRelease).isFalse();
    }
}
