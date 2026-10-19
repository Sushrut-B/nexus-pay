package io.raftline.api;

import io.raftline.client.QuorixClient;
import io.raftline.core.RaftNode;
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

public class AgentWatchIntegrationTest {

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
    void testReactiveWatchStreamPrefixAndExact(@TempDir File tempDir) throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8961,
                "node-2", 8962,
                "node-3", 8963
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9961,
                "node-2", 9962,
                "node-3", 9963
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

        // 1. Subscribe to prefix "agent:pipeline:"
        List<QuorixClient.StreamWatchEvent> receivedEvents = new CopyOnWriteArrayList<>();
        CountDownLatch latch = new CountDownLatch(3);

        QuorixClient.WatchSubscription subscription = client.watch(
                leaderUrl,
                "agent:pipeline:",
                true,
                0,
                event -> {
                    receivedEvents.add(event);
                    latch.countDown();
                }
        );

        // Allow SSE connection to establish
        Thread.sleep(300);

        // 2. Perform atomic mutations across matching keys
        client.compareAndSwap(leaderUrl, "agent:pipeline:step1", 0, "plan-drafted", "agent-planner"); // version 1
        client.compareAndSwap(leaderUrl, "agent:pipeline:step1", 1, "plan-revised", "agent-planner"); // version 2
        client.compareAndSwap(leaderUrl, "agent:pipeline:step1", 2, "plan-finalized", "agent-planner"); // version 3

        // Mutation on a non-matching key (should NOT be received)
        client.compareAndSwap(leaderUrl, "unrelated:key", 0, "ignore", "other");

        boolean receivedAll = latch.await(5, TimeUnit.SECONDS);
        assertThat(receivedAll).isTrue();
        assertThat(receivedEvents).hasSize(3);

        assertThat(receivedEvents.get(0).key()).isEqualTo("agent:pipeline:step1");
        assertThat(receivedEvents.get(0).value()).isEqualTo("plan-drafted");
        assertThat(receivedEvents.get(0).version()).isEqualTo(1L);

        assertThat(receivedEvents.get(1).key()).isEqualTo("agent:pipeline:step1");
        assertThat(receivedEvents.get(1).value()).isEqualTo("plan-revised");
        assertThat(receivedEvents.get(1).version()).isEqualTo(2L);

        assertThat(receivedEvents.get(2).key()).isEqualTo("agent:pipeline:step1");
        assertThat(receivedEvents.get(2).value()).isEqualTo("plan-finalized");
        assertThat(receivedEvents.get(2).version()).isEqualTo(3L);

        subscription.close();

        // 3. Test replay from sinceVersion = 1 (should receive version 2 and version 3)
        List<QuorixClient.StreamWatchEvent> replayed = new CopyOnWriteArrayList<>();
        CountDownLatch replayLatch = new CountDownLatch(2);

        QuorixClient.WatchSubscription replaySub = client.watch(
                leaderUrl,
                "agent:pipeline:",
                true,
                1,
                event -> {
                    replayed.add(event);
                    replayLatch.countDown();
                }
        );

        boolean replayedAll = replayLatch.await(5, TimeUnit.SECONDS);
        assertThat(replayedAll).isTrue();
        assertThat(replayed.size()).isGreaterThanOrEqualTo(2);
        assertThat(replayed.get(0).version()).isEqualTo(2L);
        assertThat(replayed.get(1).version()).isEqualTo(3L);

        replaySub.close();
    }
}
