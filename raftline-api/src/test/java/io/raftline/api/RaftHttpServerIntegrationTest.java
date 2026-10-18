package io.raftline.api;

import com.fasterxml.jackson.databind.JsonNode;
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

import static org.assertj.core.api.Assertions.assertThat;

class RaftHttpServerIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private QuorixClient client;

    @AfterEach
    void tearDown() {
        if (client != null) client.close();
        for (RaftHttpServer s : httpServers) s.close();
        for (RaftNode n : nodes) {
            try { n.close(); } catch (Exception ignored) {}
        }
    }

    @Test
    void testEndToEndClusterClientApi(@TempDir File tempDir) throws Exception {
        int n = 3;
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8911,
                "node-2", 8912,
                "node-3", 8913
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9911,
                "node-2", 9912,
                "node-3", 9913
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

            RaftConfig config = new RaftConfig(id, peers, 80, 160, 25, 100, 1000);
            WriteAheadLog wal = new WriteAheadLog(nDir, false);
            RaftMetaStorage meta = new RaftMetaStorage(nDir);
            KeyValueStore kv = new KeyValueStore();
            GrpcRaftTransport transport = new GrpcRaftTransport(id, grpcPorts.get(id), grpcAddrs);

            RaftNode node = new RaftNode(config, wal, meta, kv, transport);
            nodes.add(node);
            node.start();

            RaftHttpServer server = new RaftHttpServer(httpPorts.get(id), node, httpPorts);
            server.start();
            httpServers.add(server);

            seedHttpUrls.add("http://127.0.0.1:" + httpPorts.get(id));
        }

        // Initialize QuorixClient pointing to cluster nodes
        client = new QuorixClient(seedHttpUrls);

        // Put request: PUT user:42 "Sushrut"
        client.put("user:42", "Sushrut");

        // Linearizable read: GET user:42
        String val = client.getString("user:42");
        assertThat(val).isEqualTo("Sushrut");

        // Stale read: GET user:42?stale=true
        byte[] staleVal = client.get("user:42", true);
        assertThat(new String(staleVal)).isEqualTo("Sushrut");

        // Delete: DELETE user:42
        client.delete("user:42");
        assertThat(client.get("user:42")).isNull();

        // Check cluster status endpoint
        JsonNode status = client.getClusterStatus("http://127.0.0.1:8911");
        assertThat(status.has("role")).isTrue();
        assertThat(status.has("term")).isTrue();
        assertThat(status.has("commitIndex")).isTrue();
    }

    @Test
    void testApiKeyAuthentication(@TempDir File tempDir) throws Exception {
        String testKey = "secret-token-123";
        File nDir = new File(tempDir, "auth-node");
        nDir.mkdirs();

        RaftConfig config = new RaftConfig("auth-node", Collections.emptyList(), 80, 160, 25, 100, 1000);
        WriteAheadLog wal = new WriteAheadLog(nDir, false);
        RaftMetaStorage meta = new RaftMetaStorage(nDir);
        KeyValueStore kv = new KeyValueStore();
        GrpcRaftTransport transport = new GrpcRaftTransport("auth-node", 9921, Collections.emptyMap());

        RaftNode node = new RaftNode(config, wal, meta, kv, transport);
        nodes.add(node);
        node.start();

        RaftHttpServer server = new RaftHttpServer(8921, node, Collections.emptyMap(), testKey);
        server.start();
        httpServers.add(server);

        // 1. Client without API key -> Unauthorized
        QuorixClient unauthClient = new QuorixClient(List.of("http://127.0.0.1:8921"));
        try {
            unauthClient.put("authKey", "val");
            org.junit.jupiter.api.Assertions.fail("Should have failed with 401 Unauthorized");
        } catch (Exception e) {
            assertThat(e.getMessage()).contains("401");
        } finally {
            unauthClient.close();
        }

        // 2. Client with valid API key -> Successfully commits and reads
        QuorixClient authClient = QuorixClient.createWithApiKey(testKey, "http://127.0.0.1:8921");
        try {
            authClient.put("authKey", "val");
            String readBack = authClient.getString("authKey");
            assertThat(readBack).isEqualTo("val");
        } finally {
            authClient.close();
        }
    }

    @Test
    void testPrometheusMetricsEndpoint(@TempDir File tempDir) throws Exception {
        File nDir = new File(tempDir, "metrics-node");
        nDir.mkdirs();

        RaftConfig config = new RaftConfig("metrics-node", Collections.emptyList(), 80, 160, 25, 100, 1000);
        WriteAheadLog wal = new WriteAheadLog(nDir, false);
        RaftMetaStorage meta = new RaftMetaStorage(nDir);
        KeyValueStore kv = new KeyValueStore();
        GrpcRaftTransport transport = new GrpcRaftTransport("metrics-node", 9922, Collections.emptyMap());

        RaftNode node = new RaftNode(config, wal, meta, kv, transport);
        nodes.add(node);
        node.start();

        RaftHttpServer server = new RaftHttpServer(8922, node, Collections.emptyMap());
        server.start();
        httpServers.add(server);

        client = new QuorixClient(List.of("http://127.0.0.1:8922"));
        client.put("k1", "v1");

        String metricsText = client.getMetrics("http://127.0.0.1:8922");
        assertThat(metricsText).contains("raft_current_term{node=\"metrics-node\"}");
        assertThat(metricsText).contains("raft_commit_index{node=\"metrics-node\"}");
        assertThat(metricsText).contains("raft_last_applied{node=\"metrics-node\"}");
        assertThat(metricsText).contains("raft_is_leader{node=\"metrics-node\"} 1");
        assertThat(metricsText).contains("raft_wal_last_log_index{node=\"metrics-node\"}");
        assertThat(metricsText).contains("raft_cluster_quorum{node=\"metrics-node\"} 1");
    }
}
