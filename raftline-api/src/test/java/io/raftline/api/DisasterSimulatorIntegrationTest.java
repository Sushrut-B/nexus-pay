package io.raftline.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.client.QuorixClient;
import io.raftline.core.RaftNode;
import io.raftline.core.Role;
import io.raftline.core.config.RaftConfig;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.model.Command;
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
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

public class DisasterSimulatorIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private QuorixClient client;
    private final ObjectMapper json = new ObjectMapper();
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

    private Map<String, Integer> setupCluster(File tempDir) throws Exception {
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

        client = new QuorixClient(seedHttpUrls);
        return httpPorts;
    }

    private RaftNode awaitLeader(long timeoutMs) throws InterruptedException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            for (RaftNode nd : nodes) {
                if (nd.getRole() == Role.LEADER) {
                    return nd;
                }
            }
            Thread.sleep(50);
        }
        throw new IllegalStateException("Timed out waiting for leader election");
    }

    @Test
    void testLeaderAbdicationAndRapidReelection(@TempDir File tempDir) throws Exception {
        Map<String, Integer> httpPorts = setupCluster(tempDir);
        RaftNode leader = awaitLeader(10_000);
        String leaderId = leader.getConfig().getLocalNodeId();
        int leaderPort = httpPorts.get(leaderId);
        long initialTerm = leader.getCurrentTerm();

        // Write an initial key to verify cluster is working
        client.put("pre-chaos-key", "pre-val".getBytes(StandardCharsets.UTF_8));
        assertThat(client.get("pre-chaos-key")).isEqualTo("pre-val".getBytes(StandardCharsets.UTF_8));

        // Inject KILL_LEADER chaos via REST API on current leader
        String injectPayload = json.writeValueAsString(Map.of(
                "scenario", "KILL_LEADER",
                "target", leaderId
        ));
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/inject"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(injectPayload))
                .build();
        HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        assertThat(resp.statusCode()).isEqualTo(200);

        JsonNode injectResp = json.readTree(resp.body());
        assertThat(injectResp.get("status").asText()).isEqualTo("INJECTED");
        assertThat(injectResp.get("scenario").asText()).isEqualTo("KILL_LEADER");

        // Old leader must have stepped down
        assertThat(leader.getRole()).isNotEqualTo(Role.LEADER);
        assertThat(leader.getCurrentTerm()).isGreaterThan(initialTerm);

        // Wait for cluster to elect a new leader
        RaftNode newLeader = null;
        long deadline = System.currentTimeMillis() + 8_000;
        while (System.currentTimeMillis() < deadline) {
            for (RaftNode nd : nodes) {
                if (nd.getRole() == Role.LEADER && nd.getCurrentTerm() >= initialTerm + 1) {
                    newLeader = nd;
                    break;
                }
            }
            if (newLeader != null) break;
            Thread.sleep(50);
        }
        assertThat(newLeader).isNotNull();

        // Write new key to the new leader to prove self-healing and write continuity
        client.put("post-chaos-key", "post-val".getBytes(StandardCharsets.UTF_8));
        assertThat(client.get("post-chaos-key")).isEqualTo("post-val".getBytes(StandardCharsets.UTF_8));

        // Ensure old key is completely preserved
        assertThat(client.get("pre-chaos-key")).isEqualTo("pre-val".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void testMinorityPartitionAndSplitBrainProtection(@TempDir File tempDir) throws Exception {
        Map<String, Integer> httpPorts = setupCluster(tempDir);
        RaftNode leader = awaitLeader(10_000);
        String leaderId = leader.getConfig().getLocalNodeId();
        int leaderPort = httpPorts.get(leaderId);

        // Find a follower
        RaftNode follower = nodes.stream()
                .filter(n -> !n.getConfig().getLocalNodeId().equals(leaderId))
                .findFirst().orElseThrow();
        String followerId = follower.getConfig().getLocalNodeId();
        int followerPort = httpPorts.get(followerId);

        // 1. Isolate the follower from the leader using custom partition
        String isolatePayload = json.writeValueAsString(Map.of(
                "scenario", "CUSTOM",
                "peer", followerId,
                "isolate", true
        ));
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/inject"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(isolatePayload))
                .build();
        HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        assertThat(resp.statusCode()).isEqualTo(200);

        // 2. The majority (leader + other follower) must still successfully commit writes
        client.put("majority-key", "majority-val".getBytes(StandardCharsets.UTF_8));
        assertThat(client.get("majority-key")).isEqualTo("majority-val".getBytes(StandardCharsets.UTF_8));

        // 3. Check chaos status on leader reflects isolated peer
        HttpRequest statusReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/status"))
                .GET()
                .build();
        HttpResponse<String> statusResp = httpClient.send(statusReq, HttpResponse.BodyHandlers.ofString());
        assertThat(statusResp.statusCode()).isEqualTo(200);
        JsonNode statusJson = json.readTree(statusResp.body());
        assertThat(statusJson.get("isolatedPeers").toString()).contains(followerId);

        // 4. Heal the partition
        HttpRequest healReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/heal?all=true"))
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
        HttpResponse<String> healResp = httpClient.send(healReq, HttpResponse.BodyHandlers.ofString());
        assertThat(healResp.statusCode()).isEqualTo(200);

        // Verify status shows 0 isolated peers
        HttpResponse<String> postHealStatus = httpClient.send(statusReq, HttpResponse.BodyHandlers.ofString());
        JsonNode postHealJson = json.readTree(postHealStatus.body());
        assertThat(postHealJson.get("isolatedPeers").size()).isEqualTo(0);
    }

    @Test
    void testLatencyAndPacketLossChaosWithSelfHealingVerification(@TempDir File tempDir) throws Exception {
        Map<String, Integer> httpPorts = setupCluster(tempDir);
        RaftNode leader = awaitLeader(10_000);
        String leaderId = leader.getConfig().getLocalNodeId();
        int leaderPort = httpPorts.get(leaderId);

        // 1. Inject PACKET_JITTER_STORM with auto-heal after 2000ms
        String stormPayload = json.writeValueAsString(Map.of(
                "scenario", "PACKET_JITTER_STORM",
                "delayMs", 40,
                "dropRate", 0.1,
                "autoHealAfterMs", 2000
        ));
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/inject"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(stormPayload))
                .build();
        HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
        assertThat(resp.statusCode()).isEqualTo(200);

        // 2. Run automated validation probe via POST /v1/chaos/verify
        HttpRequest verifyReq = HttpRequest.newBuilder()
                .uri(URI.create("http://127.0.0.1:" + leaderPort + "/v1/chaos/verify"))
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
        HttpResponse<String> verifyResp = httpClient.send(verifyReq, HttpResponse.BodyHandlers.ofString());
        assertThat(verifyResp.statusCode()).isEqualTo(200);
        JsonNode verifyJson = json.readTree(verifyResp.body());
        assertThat(verifyJson.has("status")).isTrue();
        assertThat(verifyJson.has("probeLatencyMs")).isTrue();
        assertThat(verifyJson.has("checks")).isTrue();
        assertThat(verifyJson.get("checks").size()).isGreaterThan(0);

        // 3. Wait for auto-heal to execute
        Thread.sleep(2500);

        // 4. Verify post-heal status is healthy
        HttpResponse<String> postAutoHeal = httpClient.send(verifyReq, HttpResponse.BodyHandlers.ofString());
        JsonNode postAutoHealJson = json.readTree(postAutoHeal.body());
        assertThat(postAutoHealJson.get("status").asText()).isEqualTo("HEALTHY");
        assertThat(postAutoHealJson.get("activeFaultCount").asInt()).isEqualTo(0);
    }

    @Test
    void testClientSdkChaosMethods(@TempDir File tempDir) throws Exception {
        Map<String, Integer> httpPorts = setupCluster(tempDir);
        RaftNode leader = awaitLeader(10_000);
        String leaderUrl = "http://127.0.0.1:" + httpPorts.get(leader.getConfig().getLocalNodeId());

        // 1. SDK injectChaos
        String payload = json.writeValueAsString(Map.of(
                "scenario", "CUSTOM",
                "peer", "node-2",
                "delayMs", 30
        ));
        JsonNode injectResult = client.injectChaos(leaderUrl, payload);
        assertThat(injectResult.get("status").asText()).isEqualTo("INJECTED");

        // 2. SDK getChaosStatus
        JsonNode status = client.getChaosStatus(leaderUrl);
        assertThat(status.get("peerDelaysMs").has("node-2")).isTrue();

        // 3. SDK verifyClusterHealth
        JsonNode health = client.verifyClusterHealth(leaderUrl);
        assertThat(health.has("status")).isTrue();
        assertThat(health.has("checks")).isTrue();

        // 4. SDK healAllChaos
        JsonNode healResult = client.healAllChaos(leaderUrl);
        assertThat(healResult.get("status").asText()).isEqualTo("HEALED_ALL");

        // 5. Verify status is cleared
        JsonNode cleanStatus = client.getChaosStatus(leaderUrl);
        assertThat(cleanStatus.get("peerDelaysMs").size()).isEqualTo(0);
    }
}
