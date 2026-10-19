package io.raftline.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

public class SecondaryIndexIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private QuorixClient client;

    private static final ObjectMapper json = new ObjectMapper();

    @AfterEach
    void tearDown() {
        if (client != null) client.close();
        for (RaftHttpServer s : httpServers) s.close();
        for (RaftNode nd : nodes) {
            try { nd.close(); } catch (Exception ignored) {}
        }
    }

    @Test
    void testSecondaryIndexingAndDocumentFilterEngine(@TempDir File tempDir) throws Exception {
        // 1. Setup 3-node Raftline Cluster
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8991,
                "node-2", 8992,
                "node-3", 8993
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9991,
                "node-2", 9992,
                "node-3", 9993
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

        // 2. Pre-populate document to test automatic index backfilling
        client.put("order:100", "{\"status\":\"PENDING\",\"amount\":150.0,\"customer\":{\"tier\":\"SILVER\"}}");

        // 3. Register Secondary Indexes
        QuorixClient.ClientIndexInfo idxStatus = client.createIndex(leaderUrl, "idx_order_status", "order:", "status", "STRING");
        assertThat(idxStatus).isNotNull();
        assertThat(idxStatus.name()).isEqualTo("idx_order_status");
        assertThat(idxStatus.indexedKeysCount()).isEqualTo(1); // Backfilled order:100

        QuorixClient.ClientIndexInfo idxAmount = client.createIndex(leaderUrl, "idx_order_amount", "order:", "amount", "NUMBER");
        assertThat(idxAmount).isNotNull();
        assertThat(idxAmount.name()).isEqualTo("idx_order_amount");
        assertThat(idxAmount.indexedKeysCount()).isEqualTo(1);

        List<QuorixClient.ClientIndexInfo> indexes = client.listIndexes(leaderUrl);
        assertThat(indexes).hasSize(2);

        // 4. Submit dynamic JSON documents through consensus
        client.put("order:101", "{\"status\":\"PAID\",\"amount\":450.0,\"customer\":{\"tier\":\"GOLD\"}}");
        client.put("order:102", "{\"status\":\"PAID\",\"amount\":850.0,\"customer\":{\"tier\":\"SILVER\"}}");
        client.put("order:103", "{\"status\":\"CANCELLED\",\"amount\":50.0,\"customer\":{\"tier\":\"BRONZE\"}}");
        client.put("order:104", "{\"status\":\"PAID\",\"amount\":200.0,\"customer\":{\"tier\":\"GOLD\"}}");
        // Non-matching prefix
        client.put("customer:999", "{\"status\":\"PAID\",\"name\":\"Acme Corp\"}");

        // 5. Test Exact-Match Secondary Index Query (status == "PAID")
        QuorixClient.ClientQueryResult paidOrders = client.queryByField(leaderUrl, "order:", "status", "EQ", "PAID", true);
        assertThat(paidOrders).isNotNull();
        assertThat(paidOrders.usedIndex()).isTrue();
        assertThat(paidOrders.totalMatched()).isEqualTo(3);
        List<String> paidKeys = paidOrders.results().stream().map(QuorixClient.ClientDocumentMatch::key).toList();
        assertThat(paidKeys).containsExactlyInAnyOrder("order:101", "order:102", "order:104");

        // 6. Test Numerical Range Query (amount >= 200.0)
        QuorixClient.ClientQueryResult highValueOrders = client.queryByField(leaderUrl, "order:", "amount", "GTE", 200.0, true);
        assertThat(highValueOrders.usedIndex()).isTrue();
        assertThat(highValueOrders.totalMatched()).isEqualTo(3);
        List<String> highValueKeys = highValueOrders.results().stream().map(QuorixClient.ClientDocumentMatch::key).toList();
        assertThat(highValueKeys).containsExactlyInAnyOrder("order:101", "order:102", "order:104");

        // 7. Test Compound AND Query (status == "PAID" AND customer.tier == "GOLD")
        Map<String, Object> compoundQuery = Map.of(
                "prefix", "order:",
                "and", List.of(
                        Map.of("field", "status", "op", "EQ", "value", "PAID"),
                        Map.of("field", "customer.tier", "op", "EQ", "value", "GOLD")
                ),
                "includeValues", true
        );
        QuorixClient.ClientQueryResult goldPaid = client.queryDocuments(leaderUrl, compoundQuery);
        assertThat(goldPaid.usedIndex()).isTrue();
        assertThat(goldPaid.totalMatched()).isEqualTo(2);
        List<String> goldKeys = goldPaid.results().stream().map(QuorixClient.ClientDocumentMatch::key).toList();
        assertThat(goldKeys).containsExactlyInAnyOrder("order:101", "order:104");

        // 8. Test Mutation / Update Consistency
        // Update order:100 from "PENDING" to "PAID"
        client.put("order:100", "{\"status\":\"PAID\",\"amount\":150.0,\"customer\":{\"tier\":\"SILVER\"}}");

        QuorixClient.ClientQueryResult pendingCheck = client.queryByField(leaderUrl, "order:", "status", "EQ", "PENDING", true);
        assertThat(pendingCheck.totalMatched()).isEqualTo(0);

        QuorixClient.ClientQueryResult updatedPaid = client.queryByField(leaderUrl, "order:", "status", "EQ", "PAID", true);
        assertThat(updatedPaid.totalMatched()).isEqualTo(4);
        assertThat(updatedPaid.results().stream().map(QuorixClient.ClientDocumentMatch::key).toList())
                .contains("order:100");

        // 9. Test Deletion Consistency
        // Delete order:103
        client.delete("order:103");

        QuorixClient.ClientQueryResult cancelledCheck = client.queryByField(leaderUrl, "order:", "status", "EQ", "CANCELLED", true);
        assertThat(cancelledCheck.totalMatched()).isEqualTo(0);

        // 10. Test Drop Index
        boolean dropped = client.dropIndex(leaderUrl, "idx_order_status");
        assertThat(dropped).isTrue();

        List<QuorixClient.ClientIndexInfo> remainingIndexes = client.listIndexes(leaderUrl);
        assertThat(remainingIndexes).hasSize(1);
        assertThat(remainingIndexes.get(0).name()).isEqualTo("idx_order_amount");

        // Query status without index -> falls back to unindexed prefix scan
        QuorixClient.ClientQueryResult fallbackScan = client.queryByField(leaderUrl, "order:", "status", "EQ", "PAID", true);
        assertThat(fallbackScan.usedIndex()).isFalse();
        assertThat(fallbackScan.totalMatched()).isEqualTo(4);
    }
}
