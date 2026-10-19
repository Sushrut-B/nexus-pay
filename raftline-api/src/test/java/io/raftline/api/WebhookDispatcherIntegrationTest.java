package io.raftline.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import io.raftline.client.QuorixClient;
import io.raftline.core.RaftNode;
import io.raftline.core.config.RaftConfig;
import io.raftline.core.webhook.WebhookDispatcher;
import io.raftline.storage.meta.RaftMetaStorage;
import io.raftline.storage.state.KeyValueStore;
import io.raftline.storage.wal.WriteAheadLog;
import io.raftline.transport.GrpcRaftTransport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

public class WebhookDispatcherIntegrationTest {

    private final List<RaftNode> nodes = new ArrayList<>();
    private final List<RaftHttpServer> httpServers = new ArrayList<>();
    private final List<HttpServer> mockHttpServers = new ArrayList<>();
    private QuorixClient client;

    private static final ObjectMapper json = new ObjectMapper();

    @AfterEach
    void tearDown() {
        if (client != null) client.close();
        for (RaftHttpServer s : httpServers) s.close();
        for (RaftNode nd : nodes) {
            try { nd.close(); } catch (Exception ignored) {}
        }
        for (HttpServer m : mockHttpServers) {
            m.stop(0);
        }
    }

    record RecordedWebhook(
            String path,
            String signatureHeader,
            byte[] body,
            Map<String, String> headers
    ) {}

    @Test
    void testWebhookDispatchWithFilteringSignatureAndDlq(@TempDir File tempDir) throws Exception {
        // 1. Setup Mock Webhook HTTP Receiver
        List<RecordedWebhook> receivedSuccessWebhooks = new CopyOnWriteArrayList<>();
        CountDownLatch successLatch = new CountDownLatch(1);

        HttpServer mockSuccessServer = HttpServer.create(new InetSocketAddress(18091), 0);
        mockSuccessServer.createContext("/webhook/orders", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            String sig = exchange.getRequestHeaders().getFirst("X-Raftline-Signature");
            Map<String, String> hdrs = new HashMap<>();
            exchange.getRequestHeaders().forEach((k, v) -> {
                if (!v.isEmpty()) hdrs.put(k, v.get(0));
            });
            receivedSuccessWebhooks.add(new RecordedWebhook(exchange.getRequestURI().getPath(), sig, body, hdrs));

            exchange.sendResponseHeaders(200, 2);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write("OK".getBytes(StandardCharsets.UTF_8));
            }
            successLatch.countDown();
        });
        mockSuccessServer.start();
        mockHttpServers.add(mockSuccessServer);

        // Mock Failing Server (returns HTTP 500 for DLQ testing)
        AtomicInteger failingAttempts = new AtomicInteger(0);
        CountDownLatch failLatch = new CountDownLatch(2); // expect 2 attempts
        HttpServer mockFailingServer = HttpServer.create(new InetSocketAddress(18092), 0);
        mockFailingServer.createContext("/webhook/fail", exchange -> {
            failingAttempts.incrementAndGet();
            failLatch.countDown();
            exchange.sendResponseHeaders(500, 5);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write("ERROR".getBytes(StandardCharsets.UTF_8));
            }
        });
        mockFailingServer.start();
        mockHttpServers.add(mockFailingServer);

        // 2. Setup 3-node Raftline Cluster
        List<String> nodeIds = List.of("node-1", "node-2", "node-3");
        Map<String, Integer> httpPorts = Map.of(
                "node-1", 8981,
                "node-2", 8982,
                "node-3", 8983
        );
        Map<String, Integer> grpcPorts = Map.of(
                "node-1", 9981,
                "node-2", 9982,
                "node-3", 9983
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

        // 3. Register Webhook #1 (Prefix: "order:", Secret: "whsec_test_secret_12345")
        String webhookSecret = "whsec_test_secret_12345";
        String successWebhookUrl = "http://127.0.0.1:18091/webhook/orders";
        QuorixClient.WebhookInfo sub1 = client.registerWebhook(leaderUrl, successWebhookUrl, "order:", webhookSecret);
        assertThat(sub1).isNotNull();
        assertThat(sub1.id()).isNotBlank();
        assertThat(sub1.targetUrl()).isEqualTo(successWebhookUrl);
        assertThat(sub1.prefixFilter()).isEqualTo("order:");
        assertThat(sub1.hasSecret()).isTrue();

        // Register Webhook #2 (Prefix: "order:fail", maxRetries: 2, points to failing server)
        String failingWebhookUrl = "http://127.0.0.1:18092/webhook/fail";
        QuorixClient.WebhookInfo sub2 = client.registerWebhook(leaderUrl, failingWebhookUrl, "order:fail", List.of("PUT"), null, 2);
        assertThat(sub2).isNotNull();
        assertThat(sub2.maxRetries()).isEqualTo(2);

        // Verify listWebhooks
        List<QuorixClient.WebhookInfo> activeWebhooks = client.listWebhooks(leaderUrl);
        assertThat(activeWebhooks).hasSize(2);

        // 4. Test Webhook Delivery and HMAC Validation
        // Write unmatched key -> Should NOT be dispatched to mockSuccessServer
        client.put("customer:cust-99", "{\"name\":\"Bob\"}");
        // Write matched key -> Should be dispatched to mockSuccessServer
        client.put("order:1001", "{\"orderId\":\"1001\",\"total\":299.99}");

        // Wait for dispatch
        boolean arrived = successLatch.await(5, TimeUnit.SECONDS);
        assertThat(arrived).isTrue();
        assertThat(receivedSuccessWebhooks).hasSize(1);

        RecordedWebhook received = receivedSuccessWebhooks.get(0);
        assertThat(received.path()).isEqualTo("/webhook/orders");
        assertThat(received.signatureHeader()).isNotNull().startsWith("sha256=");

        // Verify HMAC-SHA256 signature calculation matches
        String computedSig = "sha256=" + WebhookDispatcher.computeHmacSha256(received.body(), webhookSecret);
        assertThat(received.signatureHeader()).isEqualTo(computedSig);

        // Verify JSON payload content
        JsonNode root = json.readTree(received.body());
        assertThat(root.get("key").asText()).isEqualTo("order:1001");
        assertThat(root.get("operation").asText()).isEqualTo("PUT");
        assertThat(root.get("payload").asText()).contains("299.99");
        assertThat(root.get("subscriptionId").asText()).isEqualTo(sub1.id());

        // 5. Test Retry Mechanism & Dead-Letter Queue (DLQ)
        // Submit key matching failing webhook subscription
        client.put("order:fail-record", "{\"failed\":true}");

        // Wait for failing attempts to complete
        boolean failAttempted = failLatch.await(5, TimeUnit.SECONDS);
        assertThat(failAttempted).isTrue();
        assertThat(failingAttempts.get()).isGreaterThanOrEqualTo(2);

        // Allow virtual thread to record to DLQ
        Thread.sleep(300);

        // Verify DLQ record
        List<QuorixClient.DeadLetterRecord> dlq = client.getDeadLetterQueue(leaderUrl, 10);
        assertThat(dlq).isNotEmpty();
        QuorixClient.DeadLetterRecord dlqRecord = dlq.stream()
                .filter(r -> r.subscriptionId().equals(sub2.id()))
                .findFirst()
                .orElse(null);

        assertThat(dlqRecord).isNotNull();
        assertThat(dlqRecord.attempts()).isEqualTo(2);
        assertThat(dlqRecord.targetUrl()).isEqualTo(failingWebhookUrl);
        assertThat(dlqRecord.failureReason()).contains("500");
        assertThat(dlqRecord.event()).isNotNull();
        assertThat(dlqRecord.event().key()).isEqualTo("order:fail-record");

        // 6. Test Unregistering Webhook
        boolean deleted = client.deleteWebhook(leaderUrl, sub1.id());
        assertThat(deleted).isTrue();

        List<QuorixClient.WebhookInfo> remaining = client.listWebhooks(leaderUrl);
        assertThat(remaining).hasSize(1);
        assertThat(remaining.get(0).id()).isEqualTo(sub2.id());

        // 7. Clear DLQ
        boolean cleared = client.clearDeadLetterQueue(leaderUrl);
        assertThat(cleared).isTrue();

        List<QuorixClient.DeadLetterRecord> emptyDlq = client.getDeadLetterQueue(leaderUrl, 10);
        assertThat(emptyDlq).isEmpty();
    }
}
