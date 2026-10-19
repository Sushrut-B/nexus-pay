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
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;

public class VisualDashboardIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private QuorixClient client;
    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @AfterEach
    void tearDown() {
        if (client != null) client.close();
        for (RaftHttpServer s : httpServers) s.close();
        for (RaftNode nd : nodes) {
            try { nd.close(); } catch (Exception ignored) {}
        }
    }

    @Test
    void testVisualWebDashboardAndOverviewEndpoint(@TempDir File tempDir) throws Exception {
        // 1. Setup 3-node Raftline Cluster
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

        // 2. Test Serving Web Dashboard HTML at /dashboard, /ui, and /
        for (String path : List.of("/dashboard", "/ui", "/")) {
            HttpRequest req = HttpRequest.newBuilder(URI.create(leaderUrl + path))
                    .GET()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            assertThat(resp.statusCode()).isEqualTo(200);
            assertThat(resp.headers().firstValue("Content-Type").orElse("")).contains("text/html");
            assertThat(resp.body()).contains("Raftline — Visual Web Dashboard & Topology Inspector");
            assertThat(resp.body()).contains("topologySvg");
            assertThat(resp.body()).contains("queryResultViewer");
            assertThat(resp.body()).contains("fetchOverview");
        }

        // 3. Populate sample state: PUT document, create index, register webhook
        client.put("order:dash-1", "{\"status\":\"DELIVERED\",\"amount\":120.5,\"customer\":{\"tier\":\"PLATINUM\"}}");
        client.createIndex(leaderUrl, "idx_dash_status", "order:", "status", "STRING");
        client.registerWebhook(leaderUrl, "http://127.0.0.1:19999/hook", "order:", "whsec_sample");

        // 4. Test Aggregated Cluster Overview Endpoint (/v1/cluster/overview)
        JsonNode overview = client.getClusterOverview(leaderUrl);
        assertThat(overview).isNotNull();

        // Verify Node Section
        JsonNode nodeNode = overview.get("node");
        assertThat(nodeNode.get("nodeId").asText()).isEqualTo(leader.getNodeId());
        assertThat(nodeNode.get("role").asText()).isEqualTo("LEADER");
        assertThat(nodeNode.get("isLeader").asBoolean()).isTrue();
        assertThat(nodeNode.get("term").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(nodeNode.get("commitIndex").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(nodeNode.get("clusterSize").asInt()).isEqualTo(3);
        assertThat(nodeNode.get("quorum").asInt()).isEqualTo(2);

        // Verify Peers Section
        JsonNode peersNode = overview.get("peers");
        assertThat(peersNode.isArray()).isTrue();
        assertThat(peersNode.size()).isEqualTo(2);

        // Verify Secondary Indexes Section
        JsonNode indexesNode = overview.get("indexes");
        assertThat(indexesNode.isArray()).isTrue();
        assertThat(indexesNode.size()).isGreaterThanOrEqualTo(1);
        boolean hasStatusIdx = false;
        for (JsonNode idx : indexesNode) {
            if ("idx_dash_status".equals(idx.get("name").asText())) {
                hasStatusIdx = true;
                assertThat(idx.get("field").asText()).isEqualTo("status");
                assertThat(idx.get("type").asText()).isEqualTo("STRING");
            }
        }
        assertThat(hasStatusIdx).isTrue();

        // Verify Webhooks Section
        JsonNode webhooksNode = overview.get("webhooks");
        assertThat(webhooksNode.isArray()).isTrue();
        assertThat(webhooksNode.size()).isGreaterThanOrEqualTo(1);
        assertThat(webhooksNode.get(0).get("prefixFilter").asText()).isEqualTo("order:");

        // Verify Recent Events Section
        JsonNode eventsNode = overview.get("recentEvents");
        assertThat(eventsNode.isArray()).isTrue();
        assertThat(eventsNode.size()).isGreaterThanOrEqualTo(1);
        boolean hasOrderEvent = false;
        for (JsonNode ev : eventsNode) {
            if ("order:dash-1".equals(ev.get("key").asText())) {
                hasOrderEvent = true;
                assertThat(ev.get("operation").asText()).isEqualTo("PUT");
                assertThat(ev.get("payload").asText()).contains("DELIVERED");
            }
        }
        assertThat(hasOrderEvent).isTrue();
    }
}
