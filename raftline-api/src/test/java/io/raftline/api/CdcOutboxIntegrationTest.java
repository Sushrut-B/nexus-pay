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
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

public class CdcOutboxIntegrationTest {

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
    void testCdcStreamAndTransactionalOutbox(@TempDir File tempDir) throws Exception {
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8971,
                "node-2", 8972,
                "node-3", 8973
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9971,
                "node-2", 9972,
                "node-3", 9973
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

        // 1. Submit various consensus operations
        // A. Standard PUT
        client.put("order:order-101", "{\"item\":\"laptop\",\"price\":1200}");
        // B. CAS mutation
        client.compareAndSwap(leaderUrl, "order:order-101", 1, "{\"item\":\"laptop\",\"price\":1150}", "agent-discount");
        // C. Transactional Outbox event
        client.sendOutboxEvent(leaderUrl, "OrderCreated", "order-101", "{\"event\":\"ORDER_PAID\",\"amount\":1150}");
        // D. DELETE
        client.delete("order:order-temp");

        Thread.sleep(200);

        // 2. Poll CDC events starting from logIndex = 0
        QuorixClient.CdcPollResult batch1 = client.pollCdcEvents(leaderUrl, 0, 50);
        assertThat(batch1).isNotNull();
        assertThat(batch1.events()).isNotEmpty();

        List<QuorixClient.ClientCdcEvent> evts = batch1.events();
        // Verify we captured PUT, CAS, OUTBOX, and DELETE
        boolean hasPut = evts.stream().anyMatch(e -> "PUT".equals(e.operation()) && "order:order-101".equals(e.key()));
        boolean hasCas = evts.stream().anyMatch(e -> "CAS".equals(e.operation()) && "order:order-101".equals(e.key()));
        boolean hasOutbox = evts.stream().anyMatch(e -> "OUTBOX".equals(e.operation()) && e.key().startsWith("__sys:outbox:OrderCreated"));

        assertThat(hasPut).isTrue();
        assertThat(hasCas).isTrue();
        assertThat(hasOutbox).isTrue();

        // 3. Acknowledge watermark progress for consumer "kafka-connector"
        long highestIdx = batch1.highestLogIndex();
        long ackWatermark = client.ackCdcWatermark(leaderUrl, "kafka-connector", highestIdx);
        assertThat(ackWatermark).isEqualTo(highestIdx);

        // 4. Poll again with sinceLogIndex = highestIdx -> Should be empty since no new writes occurred
        QuorixClient.CdcPollResult batch2 = client.pollCdcEvents(leaderUrl, highestIdx, 50);
        assertThat(batch2.events()).isEmpty();

        // 5. Write another event and poll again
        client.put("customer:cust-42", "{\"name\":\"Alice\"}");
        Thread.sleep(100);

        QuorixClient.CdcPollResult batch3 = client.pollCdcEvents(leaderUrl, highestIdx, 50);
        assertThat(batch3.events()).hasSize(1);
        assertThat(batch3.events().get(0).key()).isEqualTo("customer:cust-42");
        assertThat(batch3.events().get(0).logIndex()).isGreaterThan(highestIdx);
    }
}
