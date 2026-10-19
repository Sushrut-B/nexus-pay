package io.raftline.api;

import io.raftline.client.QuorixClient;
import io.raftline.core.RaftNode;
import io.raftline.core.agent.AgentSharedMemoryManager;
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
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

public class AgentCasIntegrationTest {

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
    void testAtomicCompareAndSwapSharedMemory(@TempDir File tempDir) throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8951,
                "node-2", 8952,
                "node-3", 8953
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9951,
                "node-2", 9952,
                "node-3", 9953
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

        String sharedKey = "agent:shared_plan:step";

        // 1. Initial State: Key does not exist yet (expectedVersion = 0)
        QuorixClient.CasResult initialCas = client.compareAndSwap(leaderUrl, sharedKey, 0, "step-1-planning", "agent-planner");
        assertThat(initialCas.success()).isTrue();
        assertThat(initialCas.version()).isEqualTo(1L);

        // 2. Query state via linearizable versioned GET
        QuorixClient.AgentState state = client.getAgentState(leaderUrl, sharedKey);
        assertThat(state).isNotNull();
        assertThat(state.key()).isEqualTo(sharedKey);
        assertThat(state.value()).isEqualTo("step-1-planning");
        assertThat(state.version()).isEqualTo(1L);

        // 3. Stale CAS attempt (expectedVersion = 0 while current is 1) -> Must fail with 409 and actualVersion = 1
        QuorixClient.CasResult staleCas = client.compareAndSwap(leaderUrl, sharedKey, 0, "stale-overwrite", "agent-malicious");
        assertThat(staleCas.success()).isFalse();
        assertThat(staleCas.statusCode()).isEqualTo(409);
        assertThat(staleCas.version()).isEqualTo(1L);

        // State remains unchanged
        QuorixClient.AgentState stateAfterStale = client.getAgentState(leaderUrl, sharedKey);
        assertThat(stateAfterStale.value()).isEqualTo("step-1-planning");
        assertThat(stateAfterStale.version()).isEqualTo(1L);

        // 4. Valid CAS transition (expectedVersion = 1 -> version = 2)
        QuorixClient.CasResult validCas = client.compareAndSwap(leaderUrl, sharedKey, 1, "step-2-execution", "agent-executor");
        assertThat(validCas.success()).isTrue();
        assertThat(validCas.version()).isEqualTo(2L);

        // 5. Test high concurrency with 10 agents contending to advance steps
        int concurrency = 10;
        ExecutorService pool = Executors.newFixedThreadPool(concurrency);
        CountDownLatch startGate = new CountDownLatch(1);
        AtomicInteger successfulTransitions = new AtomicInteger(0);
        List<Future<?>> futures = new ArrayList<>();

        for (int i = 0; i < concurrency; i++) {
            final int agentNum = i;
            futures.add(pool.submit(() -> {
                try {
                    startGate.await();
                    // Each agent tries CAS with expectedVersion = 2
                    QuorixClient.CasResult r = client.compareAndSwap(
                            leaderUrl, sharedKey, 2, "contended-by-agent-" + agentNum, "agent-" + agentNum);
                    if (r.success()) {
                        successfulTransitions.incrementAndGet();
                    }
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }));
        }

        startGate.countDown();
        for (Future<?> f : futures) {
            f.get(5, TimeUnit.SECONDS);
        }
        pool.shutdown();

        // Exactly ONE agent must have succeeded! The other 9 must have conflicted with 409
        assertThat(successfulTransitions.get()).isEqualTo(1);

        // Final version must be exactly 3
        QuorixClient.AgentState finalState = client.getAgentState(leaderUrl, sharedKey);
        assertThat(finalState.version()).isEqualTo(3L);
        assertThat(finalState.value()).startsWith("contended-by-agent-");

        // 6. Test AgentSharedMemoryManager barrier synchronization
        AgentSharedMemoryManager memManager = new AgentSharedMemoryManager(leader);
        boolean barrier1 = memManager.registerBarrier("sync-round-1", "agent-alpha", 2).get(5, TimeUnit.SECONDS);
        assertThat(barrier1).isFalse(); // only 1/2 checked in

        boolean barrier2 = memManager.registerBarrier("sync-round-1", "agent-beta", 2).get(5, TimeUnit.SECONDS);
        assertThat(barrier2).isTrue(); // 2/2 checked in, passed!

        assertThat(memManager.isBarrierPassed("sync-round-1", 2).get(5, TimeUnit.SECONDS)).isTrue();

        // 7. Test Turn Handoff
        boolean handoff1 = memManager.handoffTurn("pipeline-99", "agent-alpha", "agent-beta", "payload-step-1").get(5, TimeUnit.SECONDS);
        assertThat(handoff1).isTrue();

        // Stale agent attempts handoff -> rejected
        boolean rejected = memManager.handoffTurn("pipeline-99", "agent-alpha", "agent-gamma", "stale").get(5, TimeUnit.SECONDS);
        assertThat(rejected).isFalse();

        // Current active holder hands off to next -> succeeds
        boolean handoff2 = memManager.handoffTurn("pipeline-99", "agent-beta", "agent-gamma", "payload-step-2").get(5, TimeUnit.SECONDS);
        assertThat(handoff2).isTrue();
    }
}
