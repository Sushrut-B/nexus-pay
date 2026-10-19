package io.raftline.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import io.raftline.core.NotLeaderException;
import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class RaftHttpServer implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(RaftHttpServer.class);
    private static final ObjectMapper json = new ObjectMapper();

    private final int port;
    private final RaftNode raftNode;
    private final io.raftline.core.shard.MultiRaftManager multiRaftManager;
    private final io.raftline.core.shard.txn.TwoPhaseCommitCoordinator txnCoordinator;
    private final io.raftline.core.agent.AgentLockManager agentLockManager;
    private final io.raftline.core.agent.AgentSharedMemoryManager agentSharedMemoryManager;
    private final Map<String, Integer> peerHttpPorts;
    private final String apiKey;
    private final HttpServer server;

    public RaftHttpServer(int port, RaftNode raftNode, Map<String, Integer> peerHttpPorts) throws IOException {
        this(port, raftNode, peerHttpPorts, null);
    }

    public RaftHttpServer(int port, RaftNode raftNode, Map<String, Integer> peerHttpPorts, String apiKey) throws IOException {
        this(port, raftNode, null, peerHttpPorts, apiKey);
    }

    public RaftHttpServer(int port, RaftNode raftNode, io.raftline.core.shard.MultiRaftManager multiRaftManager, Map<String, Integer> peerHttpPorts, String apiKey) throws IOException {
        this.port = port;
        this.raftNode = raftNode;
        this.multiRaftManager = multiRaftManager;
        this.txnCoordinator = (multiRaftManager != null) ? new io.raftline.core.shard.txn.TwoPhaseCommitCoordinator(multiRaftManager) : null;
        this.agentLockManager = (raftNode != null) ? new io.raftline.core.agent.AgentLockManager(raftNode) : null;
        this.agentSharedMemoryManager = (raftNode != null) ? new io.raftline.core.agent.AgentSharedMemoryManager(raftNode) : null;
        this.peerHttpPorts = peerHttpPorts != null ? peerHttpPorts : Map.of();
        this.apiKey = (apiKey != null && !apiKey.isBlank()) ? apiKey.trim() : null;

        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        this.server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());

        setupRoutes();
    }

    public void start() {
        server.start();
        log.info("Raft REST API Server listening on port {} (Auth={}, MultiRaft={})",
                port, (apiKey != null ? "ENABLED" : "DISABLED"), (multiRaftManager != null ? "ENABLED" : "DISABLED"));
    }

    private boolean isAuthorized(HttpExchange exchange) {
        if (apiKey == null) {
            return true;
        }
        String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring("Bearer ".length()).trim();
            return apiKey.equals(token);
        }
        String customKey = exchange.getRequestHeaders().getFirst("X-API-Key");
        return apiKey.equals(customKey);
    }

    private void setupRoutes() {
        server.createContext("/v1/kv", new KeyValueHandler());
        server.createContext("/v1/cluster/status", new StatusHandler());
        server.createContext("/v1/cluster/nodes", new NodesHandler());
        server.createContext("/v1/cluster/members", new MembersHandler());
        server.createContext("/v1/cluster/shards", new ShardsHandler());
        server.createContext("/v1/txn", new TxnHandler());
        server.createContext("/v1/health/live", new LivenessHandler());
        server.createContext("/v1/health/ready", new ReadinessHandler());
        server.createContext("/v1/metrics", new MetricsHandler());
        server.createContext("/v1/admin/snapshot", new AdminSnapshotHandler());
        server.createContext("/v1/agent/lock", new AgentLockHandler());
        server.createContext("/v1/agent/cas", new AgentCasHandler());
        server.createContext("/v1/agent/state", new AgentStateHandler());
        server.createContext("/v1/agent/watch", new AgentWatchHandler());
        server.createContext("/v1/cdc/events", new CdcEventsHandler());
        server.createContext("/v1/cdc/ack", new CdcAckHandler());
        server.createContext("/v1/cdc/webhooks", new CdcWebhooksHandler());
        server.createContext("/v1/cdc/dlq", new CdcDlqHandler());
    }

    private class TxnHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Transactions must use POST"));
                return;
            }

            if (txnCoordinator == null) {
                sendJson(exchange, 501, Map.of("error", "Multi-Raft 2PC transaction coordinator is not enabled on this node"));
                return;
            }

            try {
                Map<String, String> writesRaw = json.readValue(exchange.getRequestBody(), Map.class);
                Map<String, byte[]> writes = new HashMap<>();
                for (var e : writesRaw.entrySet()) {
                    writes.put(e.getKey(), e.getValue().getBytes(StandardCharsets.UTF_8));
                }

                boolean success = txnCoordinator.executeTransaction(writes).get(5, TimeUnit.SECONDS);
                if (success) {
                    sendJson(exchange, 200, Map.of(
                            "status", "COMMITTED",
                            "totalOperations", writes.size()
                    ));
                } else {
                    sendJson(exchange, 409, Map.of(
                            "status", "ABORTED",
                            "error", "2PC transaction could not achieve consensus across all shards"
                    ));
                }
            } catch (Exception e) {
                log.error("Failed to execute 2PC transaction", e);
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    private class AgentLockHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (agentLockManager == null) {
                sendJson(exchange, 501, Map.of("error", "AgentLockManager is not enabled on this node"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod().toUpperCase();

            try {
                if ("GET".equals(method)) {
                    Map<String, String> query = parseQueryParams(exchange.getRequestURI().getQuery());
                    String resource = query.get("resource");
                    if (resource == null || resource.isBlank()) {
                        sendJson(exchange, 400, Map.of("error", "Query parameter 'resource' is required"));
                        return;
                    }

                    var lockOpt = agentLockManager.getLockStatus(resource).get(5, TimeUnit.SECONDS);
                    if (lockOpt.isPresent()) {
                        var lock = lockOpt.get();
                        sendJson(exchange, 200, Map.of(
                                "status", "LOCKED",
                                "resource", lock.getResource(),
                                "ownerAgentId", lock.getOwnerAgentId(),
                                "fencingToken", lock.getFencingToken(),
                                "acquiredAtEpochMs", lock.getAcquiredAtEpochMs(),
                                "expiresAtEpochMs", lock.getExpiresAtEpochMs(),
                                "expired", lock.isExpired()
                        ));
                    } else {
                        sendJson(exchange, 404, Map.of("status", "UNLOCKED", "resource", resource));
                    }
                    return;
                }

                if ("POST".equals(method)) {
                    Map<String, Object> body = json.readValue(exchange.getRequestBody(), Map.class);
                    String resource = (String) body.get("resource");
                    String agentId = (String) body.get("agentId");

                    if (resource == null || resource.isBlank() || agentId == null || agentId.isBlank()) {
                        sendJson(exchange, 400, Map.of("error", "resource and agentId are required"));
                        return;
                    }

                    if (path.endsWith("/acquire")) {
                        long ttlMs = body.containsKey("ttlMs") ? ((Number) body.get("ttlMs")).longValue() : 10000L;
                        var resultOpt = agentLockManager.acquireLock(resource, agentId, ttlMs).get(5, TimeUnit.SECONDS);
                        if (resultOpt.isPresent()) {
                            var lock = resultOpt.get();
                            sendJson(exchange, 200, Map.of(
                                    "status", "ACQUIRED",
                                    "resource", lock.getResource(),
                                    "ownerAgentId", lock.getOwnerAgentId(),
                                    "fencingToken", lock.getFencingToken(),
                                    "acquiredAtEpochMs", lock.getAcquiredAtEpochMs(),
                                    "expiresAtEpochMs", lock.getExpiresAtEpochMs()
                            ));
                        } else {
                            sendJson(exchange, 409, Map.of(
                                    "status", "LOCK_HELD",
                                    "error", "Lock is currently held by another agent"
                            ));
                        }
                        return;
                    } else if (path.endsWith("/renew")) {
                        if (!body.containsKey("fencingToken")) {
                            sendJson(exchange, 400, Map.of("error", "fencingToken is required for lock renewal"));
                            return;
                        }
                        long fencingToken = ((Number) body.get("fencingToken")).longValue();
                        long extendTtlMs = body.containsKey("extendTtlMs") ? ((Number) body.get("extendTtlMs")).longValue() : 10000L;

                        var renewedOpt = agentLockManager.renewLock(resource, agentId, fencingToken, extendTtlMs).get(5, TimeUnit.SECONDS);
                        if (renewedOpt.isPresent()) {
                            var lock = renewedOpt.get();
                            sendJson(exchange, 200, Map.of(
                                    "status", "RENEWED",
                                    "resource", lock.getResource(),
                                    "ownerAgentId", lock.getOwnerAgentId(),
                                    "fencingToken", lock.getFencingToken(),
                                    "expiresAtEpochMs", lock.getExpiresAtEpochMs()
                            ));
                        } else {
                            sendJson(exchange, 403, Map.of(
                                    "status", "RENEW_REJECTED",
                                    "error", "Lock not found or fencing token mismatch"
                            ));
                        }
                        return;
                    } else if (path.endsWith("/release")) {
                        if (!body.containsKey("fencingToken")) {
                            sendJson(exchange, 400, Map.of("error", "fencingToken is required for lock release"));
                            return;
                        }
                        long fencingToken = ((Number) body.get("fencingToken")).longValue();

                        boolean released = agentLockManager.releaseLock(resource, agentId, fencingToken).get(5, TimeUnit.SECONDS);
                        if (released) {
                            sendJson(exchange, 200, Map.of(
                                    "status", "RELEASED",
                                    "resource", resource,
                                    "fencingToken", fencingToken
                            ));
                        } else {
                            sendJson(exchange, 403, Map.of(
                                    "status", "RELEASE_REJECTED",
                                    "error", "Cannot release lock: token mismatch or unauthorized agent"
                            ));
                        }
                        return;
                    }
                }

                sendJson(exchange, 405, Map.of("error", "Method not allowed for path: " + path));
            } catch (Exception e) {
                Throwable cause = (e instanceof ExecutionException) ? e.getCause() : e;
                if (cause instanceof RuntimeException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof ExecutionException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof NotLeaderException nle) {
                    Integer leaderPort = peerHttpPorts.get(nle.getLeaderHint());
                    String redirectUrl = (leaderPort != null) ? "http://localhost:" + leaderPort + path + (exchange.getRequestURI().getQuery() != null ? "?" + exchange.getRequestURI().getQuery() : "") : null;
                    if (redirectUrl != null) {
                        exchange.getResponseHeaders().set("Location", redirectUrl);
                    }
                    sendJson(exchange, 307, Map.of("error", "Node is not the leader", "leaderHint", nle.getLeaderHint() != null ? nle.getLeaderHint() : "unknown", "redirectUrl", redirectUrl != null ? redirectUrl : ""));
                } else {
                    log.error("AgentLockHandler failure", e);
                    sendJson(exchange, 500, Map.of("error", cause.getMessage() != null ? cause.getMessage() : e.getMessage()));
                }
            }
        }
    }

    private class AgentCasHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "CAS requests must use POST"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            try {
                Map<String, Object> body = json.readValue(exchange.getRequestBody(), Map.class);
                String key = (String) body.get("key");
                if (key == null || key.isBlank()) {
                    sendJson(exchange, 400, Map.of("error", "Missing required field: key"));
                    return;
                }

                if (!body.containsKey("expectedVersion")) {
                    sendJson(exchange, 400, Map.of("error", "Missing required field: expectedVersion"));
                    return;
                }
                long expectedVersion = ((Number) body.get("expectedVersion")).longValue();

                Object valueObj = body.get("value");
                byte[] valueBytes = new byte[0];
                if (valueObj != null) {
                    if (valueObj instanceof String str) {
                        valueBytes = str.getBytes(StandardCharsets.UTF_8);
                    } else {
                        valueBytes = json.writeValueAsBytes(valueObj);
                    }
                }

                String agentId = (String) body.getOrDefault("agentId", "agent-anonymous");
                long seqNum = System.nanoTime();

                ApplyResult result = raftNode.compareAndSwap(key, expectedVersion, valueBytes, "agent:" + agentId, seqNum)
                        .get(5, TimeUnit.SECONDS);

                if (result.isSuccess()) {
                    sendJson(exchange, 200, Map.of(
                            "status", "COMMITTED",
                            "key", key,
                            "version", result.getVersion()
                    ));
                } else if ("CAS_VERSION_MISMATCH".equals(result.getError())) {
                    String actualValStr = (result.getValue() != null && result.getValue().length > 0)
                            ? new String(result.getValue(), StandardCharsets.UTF_8)
                            : null;
                    sendJson(exchange, 409, Map.of(
                            "status", "VERSION_MISMATCH",
                            "error", "Compare-And-Swap version mismatch",
                            "key", key,
                            "expectedVersion", expectedVersion,
                            "actualVersion", result.getVersion(),
                            "currentValue", actualValStr != null ? actualValStr : ""
                    ));
                } else {
                    sendJson(exchange, 500, Map.of("error", "Failed to apply CAS command", "details", result.getError() != null ? result.getError() : "Unknown error"));
                }
            } catch (Exception e) {
                Throwable cause = (e instanceof ExecutionException) ? e.getCause() : e;
                if (cause instanceof RuntimeException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof ExecutionException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof NotLeaderException nle) {
                    Integer leaderPort = peerHttpPorts.get(nle.getLeaderHint());
                    String redirectUrl = (leaderPort != null) ? "http://localhost:" + leaderPort + path : null;
                    if (redirectUrl != null) {
                        exchange.getResponseHeaders().set("Location", redirectUrl);
                    }
                    sendJson(exchange, 307, Map.of("error", "Node is not the leader", "leaderHint", nle.getLeaderHint() != null ? nle.getLeaderHint() : "unknown", "redirectUrl", redirectUrl != null ? redirectUrl : ""));
                } else {
                    log.error("AgentCasHandler failure", e);
                    sendJson(exchange, 500, Map.of("error", cause.getMessage() != null ? cause.getMessage() : e.getMessage()));
                }
            }
        }
    }

    private class AgentStateHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "State reads must use GET"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            try {
                Map<String, String> query = parseQueryParams(exchange.getRequestURI().getQuery());
                String key = query.get("key");
                if (key == null || key.isBlank()) {
                    sendJson(exchange, 400, Map.of("error", "Query parameter 'key' is required"));
                    return;
                }

                io.raftline.storage.state.VersionedValue vv = raftNode.readLinearizableVersioned(key).get(5, TimeUnit.SECONDS);
                if (vv == null || vv.version() == 0 || vv.value() == null) {
                    sendJson(exchange, 404, Map.of("status", "NOT_FOUND", "key", key, "version", 0));
                    return;
                }

                String valStr = new String(vv.value(), StandardCharsets.UTF_8);
                sendJson(exchange, 200, Map.of(
                        "status", "FOUND",
                        "key", key,
                        "value", valStr,
                        "version", vv.version()
                ));
            } catch (Exception e) {
                Throwable cause = (e instanceof ExecutionException) ? e.getCause() : e;
                if (cause instanceof RuntimeException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof ExecutionException && cause.getCause() != null) {
                    cause = cause.getCause();
                }
                if (cause instanceof NotLeaderException nle) {
                    Integer leaderPort = peerHttpPorts.get(nle.getLeaderHint());
                    String redirectUrl = (leaderPort != null) ? "http://localhost:" + leaderPort + path + (exchange.getRequestURI().getQuery() != null ? "?" + exchange.getRequestURI().getQuery() : "") : null;
                    if (redirectUrl != null) {
                        exchange.getResponseHeaders().set("Location", redirectUrl);
                    }
                    sendJson(exchange, 307, Map.of("error", "Node is not the leader", "leaderHint", nle.getLeaderHint() != null ? nle.getLeaderHint() : "unknown", "redirectUrl", redirectUrl != null ? redirectUrl : ""));
                } else {
                    log.error("AgentStateHandler failure", e);
                    sendJson(exchange, 500, Map.of("error", cause.getMessage() != null ? cause.getMessage() : e.getMessage()));
                }
            }
        }
    }

    private class AgentWatchHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Watch requests must use GET"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            Map<String, String> query = parseQueryParams(exchange.getRequestURI().getQuery());
            String key = query.get("key");
            String prefix = query.get("prefix");

            if ((key == null || key.isBlank()) && (prefix == null || prefix.isBlank())) {
                sendJson(exchange, 400, Map.of("error", "Either 'key' or 'prefix' query parameter is required"));
                return;
            }

            boolean isPrefix = prefix != null && !prefix.isBlank();
            String filter = isPrefix ? prefix : key;

            long sinceVersion = 0;
            if (query.containsKey("sinceVersion")) {
                try {
                    sinceVersion = Long.parseLong(query.get("sinceVersion"));
                } catch (NumberFormatException ignored) {}
            }

            // Set SSE headers
            var headers = exchange.getResponseHeaders();
            headers.set("Content-Type", "text/event-stream; charset=UTF-8");
            headers.set("Cache-Control", "no-cache");
            headers.set("Connection", "keep-alive");
            exchange.sendResponseHeaders(200, 0); // chunked transfer encoding

            OutputStream out = exchange.getResponseBody();

            // Send initial ping/connection event
            String initialMsg = "event: connected\ndata: {\"status\":\"CONNECTED\",\"filter\":\"" + filter + "\",\"isPrefix\":" + isPrefix + "}\n\n";
            out.write(initialMsg.getBytes(StandardCharsets.UTF_8));
            out.flush();

            try (var watcher = raftNode.getWatchEngine().watch(filter, isPrefix, sinceVersion, null)) {
                long keepAliveIntervalMs = 5000;
                long lastPing = System.currentTimeMillis();

                while (watcher.isActive()) {
                    io.raftline.core.agent.WatchEvent event = watcher.poll(500);
                    if (event != null) {
                        String eventVal = (event.value() != null && event.value().length > 0)
                                ? new String(event.value(), StandardCharsets.UTF_8)
                                : "";
                        Map<String, Object> map = Map.of(
                                "type", event.type().name(),
                                "key", event.key(),
                                "value", eventVal,
                                "version", event.version(),
                                "logIndex", event.logIndex(),
                                "timestamp", event.timestampEpochMs()
                        );
                        String sse = "event: message\ndata: " + json.writeValueAsString(map) + "\n\n";
                        out.write(sse.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        lastPing = System.currentTimeMillis();
                    } else {
                        // Periodic heartbeat comment to keep HTTP connection alive and detect client disconnect
                        long now = System.currentTimeMillis();
                        if (now - lastPing >= keepAliveIntervalMs) {
                            out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8));
                            out.flush();
                            lastPing = now;
                        }
                    }
                }
            } catch (IOException e) {
                // Client closed socket or disconnected
                log.debug("Watcher client disconnected: {}", e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                try {
                    out.close();
                } catch (Exception ignored) {}
            }
        }
    }

    private class CdcEventsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "CDC events polling must use GET"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            Map<String, String> query = parseQueryParams(exchange.getRequestURI().getQuery());
            long sinceLogIndex = 0;
            if (query.containsKey("sinceLogIndex")) {
                try {
                    sinceLogIndex = Long.parseLong(query.get("sinceLogIndex"));
                } catch (NumberFormatException ignored) {}
            }

            int limit = 100;
            if (query.containsKey("limit")) {
                try {
                    limit = Integer.parseInt(query.get("limit"));
                } catch (NumberFormatException ignored) {}
            }

            List<io.raftline.core.cdc.CdcEvent> rawEvents = raftNode.getCdcEngine().pollEvents(sinceLogIndex, limit);
            List<Map<String, Object>> events = new ArrayList<>(rawEvents.size());
            for (io.raftline.core.cdc.CdcEvent ev : rawEvents) {
                String valStr = (ev.payload() != null && ev.payload().length > 0)
                        ? new String(ev.payload(), StandardCharsets.UTF_8)
                        : "";
                events.add(Map.of(
                        "eventId", ev.eventId(),
                        "logIndex", ev.logIndex(),
                        "logTerm", ev.logTerm(),
                        "operation", ev.operation().name(),
                        "key", ev.key(),
                        "payload", valStr,
                        "version", ev.version(),
                        "timestamp", ev.timestampEpochMs()
                ));
            }

            long highestIndex = rawEvents.isEmpty() ? sinceLogIndex : rawEvents.get(rawEvents.size() - 1).logIndex();
            sendJson(exchange, 200, Map.of(
                    "status", "OK",
                    "sinceLogIndex", sinceLogIndex,
                    "highestLogIndex", highestIndex,
                    "count", events.size(),
                    "events", events
            ));
        }
    }

    private class CdcAckHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Watermark acknowledgment must use POST"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            try {
                Map<String, Object> body = json.readValue(exchange.getRequestBody(), Map.class);
                String consumerId = (String) body.get("consumerId");
                if (consumerId == null || consumerId.isBlank()) {
                    sendJson(exchange, 400, Map.of("error", "consumerId is required"));
                    return;
                }

                if (!body.containsKey("logIndex")) {
                    sendJson(exchange, 400, Map.of("error", "logIndex is required"));
                    return;
                }
                long logIndex = ((Number) body.get("logIndex")).longValue();

                long updated = raftNode.getCdcEngine().acknowledgeWatermark(consumerId, logIndex);
                sendJson(exchange, 200, Map.of(
                        "status", "ACKNOWLEDGED",
                        "consumerId", consumerId,
                        "watermark", updated
                ));
            } catch (Exception e) {
                log.error("Failed to acknowledge CDC watermark", e);
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    private class CdcWebhooksHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            String method = exchange.getRequestMethod().toUpperCase();
            if ("GET".equals(method)) {
                List<io.raftline.core.webhook.WebhookSubscription> subs = raftNode.getWebhookDispatcher().getAllSubscriptions();
                List<Map<String, Object>> subsList = new ArrayList<>(subs.size());
                for (var s : subs) {
                    subsList.add(s.toMap());
                }
                sendJson(exchange, 200, Map.of(
                        "status", "OK",
                        "count", subsList.size(),
                        "webhooks", subsList
                ));
                return;
            }

            if ("POST".equals(method)) {
                try {
                    Map<String, Object> body = json.readValue(exchange.getRequestBody(), Map.class);
                    String targetUrl = (String) body.get("targetUrl");
                    if (targetUrl == null || targetUrl.isBlank()) {
                        sendJson(exchange, 400, Map.of("error", "targetUrl is required"));
                        return;
                    }

                    String id = (String) body.get("id");
                    if (id == null || id.isBlank()) {
                        id = "webhook-" + UUID.randomUUID();
                    }

                    String prefix = (String) body.getOrDefault("prefix", "");
                    String secret = (String) body.get("secret");
                    int maxRetries = 3;
                    if (body.containsKey("maxRetries")) {
                        try {
                            maxRetries = ((Number) body.get("maxRetries")).intValue();
                        } catch (Exception ignored) {}
                    }

                    Set<io.raftline.core.cdc.CdcEvent.OperationType> ops = new HashSet<>();
                    if (body.containsKey("operations")) {
                        Object opsObj = body.get("operations");
                        if (opsObj instanceof List<?> list) {
                            for (Object item : list) {
                                try {
                                    ops.add(io.raftline.core.cdc.CdcEvent.OperationType.valueOf(item.toString().toUpperCase()));
                                } catch (IllegalArgumentException ignored) {}
                            }
                        }
                    }

                    io.raftline.core.webhook.WebhookSubscription sub = new io.raftline.core.webhook.WebhookSubscription(
                            id, targetUrl, prefix, ops, secret, maxRetries
                    );
                    raftNode.getWebhookDispatcher().registerSubscription(sub);

                    sendJson(exchange, 201, Map.of(
                            "status", "REGISTERED",
                            "webhook", sub.toMap()
                    ));
                } catch (Exception e) {
                    log.error("Failed to register webhook subscription", e);
                    sendJson(exchange, 500, Map.of("error", e.getMessage()));
                }
                return;
            }

            if ("DELETE".equals(method)) {
                String subId = null;
                Map<String, String> q = parseQueryParams(exchange.getRequestURI().getQuery());
                if (q.containsKey("id")) {
                    subId = q.get("id");
                } else {
                    try {
                        byte[] reqBytes = exchange.getRequestBody().readAllBytes();
                        if (reqBytes.length > 0) {
                            Map<String, Object> body = json.readValue(reqBytes, Map.class);
                            subId = (String) body.get("id");
                        }
                    } catch (Exception ignored) {}
                }

                if (subId == null || subId.isBlank()) {
                    sendJson(exchange, 400, Map.of("error", "Subscription id is required as ?id={id} or JSON body"));
                    return;
                }

                boolean removed = raftNode.getWebhookDispatcher().unregisterSubscription(subId);
                if (removed) {
                    sendJson(exchange, 200, Map.of(
                            "status", "UNREGISTERED",
                            "id", subId
                    ));
                } else {
                    sendJson(exchange, 404, Map.of(
                            "error", "Webhook subscription not found: " + subId
                    ));
                }
                return;
            }

            sendJson(exchange, 405, Map.of("error", "Method not allowed: " + method));
        }
    }

    private class CdcDlqHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (raftNode == null) {
                sendJson(exchange, 501, Map.of("error", "RaftNode is not initialized on this instance"));
                return;
            }

            String method = exchange.getRequestMethod().toUpperCase();
            if ("GET".equals(method)) {
                Map<String, String> query = parseQueryParams(exchange.getRequestURI().getQuery());
                int limit = 100;
                if (query.containsKey("limit")) {
                    try {
                        limit = Integer.parseInt(query.get("limit"));
                    } catch (NumberFormatException ignored) {}
                }

                List<io.raftline.core.webhook.DeadLetterEvent> rawRecords = raftNode.getWebhookDispatcher().getDeadLetterQueue(limit);
                List<Map<String, Object>> records = new ArrayList<>(rawRecords.size());
                for (var r : rawRecords) {
                    records.add(r.toMap());
                }

                sendJson(exchange, 200, Map.of(
                        "status", "OK",
                        "count", records.size(),
                        "records", records
                ));
                return;
            }

            if ("DELETE".equals(method)) {
                raftNode.getWebhookDispatcher().clearDeadLetterQueue();
                sendJson(exchange, 200, Map.of(
                        "status", "CLEARED"
                ));
                return;
            }

            sendJson(exchange, 405, Map.of("error", "Method not allowed: " + method));
        }
    }

    private class LivenessHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            sendJson(exchange, 200, Map.of(
                    "status", "UP",
                    "nodeId", raftNode.getNodeId()
            ));
        }
    }

    private class ReadinessHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            boolean hasLeader = raftNode.getCurrentLeaderId() != null;
            int code = hasLeader ? 200 : 503;
            sendJson(exchange, code, Map.of(
                    "ready", hasLeader,
                    "nodeId", raftNode.getNodeId(),
                    "role", raftNode.getRole().name(),
                    "currentLeaderId", hasLeader ? raftNode.getCurrentLeaderId() : "none"
            ));
        }
    }

    private class ShardsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (multiRaftManager == null) {
                sendJson(exchange, 200, Map.of(
                        "sharding", "DISABLED",
                        "shards", List.of()
                ));
                return;
            }

            String method = exchange.getRequestMethod().toUpperCase();
            if ("GET".equals(method)) {
                var shards = multiRaftManager.getRouter().getAllShards();
                List<Map<String, Object>> shardList = new ArrayList<>();
                for (var s : shards) {
                    Map<String, Object> map = new LinkedHashMap<>();
                    map.put("shardId", s.shardId());
                    map.put("startKey", s.range().startKey());
                    map.put("endKey", s.range().endKey());
                    map.put("replicas", s.replicaNodeIds());
                    var groupOpt = multiRaftManager.getGroup(s.shardId());
                    if (groupOpt.isPresent()) {
                        var group = groupOpt.get();
                        map.put("role", group.getRole().name());
                        map.put("term", group.getCurrentTerm());
                        map.put("leaderId", group.getCurrentLeaderId());
                    }
                    shardList.add(map);
                }

                sendJson(exchange, 200, Map.of(
                        "sharding", "ENABLED",
                        "totalShards", shardList.size(),
                        "shards", shardList
                ));
                return;
            }

            if ("POST".equals(method)) {
                if (!isAuthorized(exchange)) {
                    sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                    return;
                }

                try {
                    Map<String, Object> body = json.readValue(exchange.getRequestBody(), Map.class);
                    String action = ((String) body.getOrDefault("action", "SPLIT")).toUpperCase();

                    if ("SPLIT".equals(action)) {
                        String originalShardId = (String) body.get("originalShardId");
                        String splitKey = (String) body.get("splitKey");
                        String newLeftShardId = (String) body.get("newLeftShardId");
                        String newRightShardId = (String) body.get("newRightShardId");
                        List<String> leftReplicas = (List<String>) body.get("leftReplicas");
                        List<String> rightReplicas = (List<String>) body.get("rightReplicas");

                        if (originalShardId == null || splitKey == null || newLeftShardId == null || newRightShardId == null) {
                            sendJson(exchange, 400, Map.of("error", "originalShardId, splitKey, newLeftShardId, and newRightShardId are required"));
                            return;
                        }

                        var result = multiRaftManager.getRouter().splitShard(
                                originalShardId, splitKey, newLeftShardId, newRightShardId, leftReplicas, rightReplicas);

                        sendJson(exchange, 200, Map.of(
                                "status", "SPLIT_SUCCESS",
                                "originalShardId", originalShardId,
                                "leftShard", Map.of("id", result[0].shardId(), "startKey", result[0].range().startKey(), "endKey", result[0].range().endKey()),
                                "rightShard", Map.of("id", result[1].shardId(), "startKey", result[1].range().startKey(), "endKey", result[1].range().endKey())
                        ));
                        return;
                    } else if ("REBALANCE".equals(action)) {
                        String shardId = (String) body.get("shardId");
                        List<String> replicas = (List<String>) body.get("replicas");
                        if (shardId == null || replicas == null) {
                            sendJson(exchange, 400, Map.of("error", "shardId and replicas are required"));
                            return;
                        }

                        var updated = multiRaftManager.getRouter().rebalanceShard(shardId, replicas);
                        sendJson(exchange, 200, Map.of(
                                "status", "REBALANCE_SUCCESS",
                                "shardId", updated.shardId(),
                                "replicas", updated.replicaNodeIds()
                        ));
                        return;
                    } else {
                        sendJson(exchange, 400, Map.of("error", "action must be SPLIT or REBALANCE"));
                        return;
                    }
                } catch (Exception e) {
                    log.error("Failed to process shard mutation", e);
                    sendJson(exchange, 500, Map.of("error", e.getMessage()));
                }
                return;
            }

            sendJson(exchange, 405, Map.of("error", "Method not allowed: " + method));
        }
    }

    private void sendJson(HttpExchange exchange, int statusCode, Object data) throws IOException {
        byte[] bytes = json.writeValueAsBytes(data);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private void sendPlainText(HttpExchange exchange, int statusCode, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private Map<String, String> parseQueryParams(String query) {
        if (query == null || query.isBlank()) return Collections.emptyMap();
        Map<String, String> map = new java.util.LinkedHashMap<>();
        for (String param : query.split("&")) {
            String[] pair = param.split("=", 2);
            if (pair.length == 2) {
                map.put(pair[0], java.net.URLDecoder.decode(pair[1], StandardCharsets.UTF_8));
            } else if (pair.length == 1) {
                map.put(pair[0], "");
            }
        }
        return map;
    }

    private class KeyValueHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod();

            if ("/v1/kv/batch".equals(path)) {
                if (!"POST".equalsIgnoreCase(method)) {
                    sendJson(exchange, 405, Map.of("error", "Batch operation must use POST"));
                    return;
                }

                String clientId = exchange.getRequestHeaders().getFirst("X-Client-Id");
                if (clientId == null || clientId.isBlank()) {
                    clientId = UUID.randomUUID().toString();
                }

                try {
                    byte[] body = exchange.getRequestBody().readAllBytes();
                    JsonNode root = json.readTree(body);
                    if (!root.isArray()) {
                        sendJson(exchange, 400, Map.of("error", "Batch request payload must be a JSON array of operations"));
                        return;
                    }

                    List<Command> commands = new ArrayList<>();
                    long baseSeq = System.nanoTime();
                    int idx = 0;
                    for (JsonNode opNode : root) {
                        String op = opNode.has("op") ? opNode.get("op").asText().toUpperCase() : "PUT";
                        String opKey = opNode.has("key") ? opNode.get("key").asText() : null;
                        if (opKey == null || opKey.isBlank()) {
                            sendJson(exchange, 400, Map.of("error", "Each batch operation must provide a non-empty 'key'"));
                            return;
                        }

                        if ("PUT".equals(op)) {
                            String val = opNode.has("value") ? opNode.get("value").asText() : "";
                            commands.add(Command.put(opKey, val.getBytes(StandardCharsets.UTF_8), clientId, baseSeq + idx));
                        } else if ("DELETE".equals(op)) {
                            commands.add(Command.delete(opKey, clientId, baseSeq + idx));
                        } else {
                            sendJson(exchange, 400, Map.of("error", "Unsupported batch operation: " + op));
                            return;
                        }
                        idx++;
                    }

                    List<ApplyResult> results = raftNode.executeBatch(commands).get(15, TimeUnit.SECONDS);
                    sendJson(exchange, 200, Map.of(
                            "status", "COMMITTED",
                            "count", results.size()
                    ));
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    if (cause instanceof NotLeaderException nle) {
                        handleNotLeader(exchange, nle.getLeaderHint());
                    } else {
                        sendJson(exchange, 500, Map.of("error", e.getMessage()));
                    }
                } catch (Exception e) {
                    sendJson(exchange, 500, Map.of("error", e.getMessage()));
                }
                return;
            }

            if ("/v1/kv/scan".equals(path) || "/v1/kv".equals(path)) {
                if (!"GET".equalsIgnoreCase(method)) {
                    sendJson(exchange, 405, Map.of("error", "Range scan must use GET"));
                    return;
                }
                String query = exchange.getRequestURI().getQuery();
                Map<String, String> qMap = parseQueryParams(query);
                String from = qMap.get("from");
                String to = qMap.get("to");
                int limit = qMap.containsKey("limit") ? Integer.parseInt(qMap.get("limit")) : 100;
                boolean stale = "true".equalsIgnoreCase(qMap.get("stale"));

                try {
                    Map<String, byte[]> scanResults;
                    if (stale) {
                        scanResults = raftNode.scanStale(from, to, limit);
                    } else {
                        scanResults = raftNode.scanLinearizable(from, to, limit).get(5, TimeUnit.SECONDS);
                    }

                    Map<String, String> stringResults = new java.util.LinkedHashMap<>();
                    for (Map.Entry<String, byte[]> e : scanResults.entrySet()) {
                        stringResults.put(e.getKey(), new String(e.getValue(), StandardCharsets.UTF_8));
                    }

                    sendJson(exchange, 200, Map.of(
                            "count", stringResults.size(),
                            "from", from != null ? from : "",
                            "to", to != null ? to : "",
                            "data", stringResults
                    ));
                } catch (ExecutionException e) {
                    Throwable cause = e.getCause();
                    if (cause instanceof NotLeaderException nle) {
                        handleNotLeader(exchange, nle.getLeaderHint());
                    } else {
                        sendJson(exchange, 500, Map.of("error", e.getMessage()));
                    }
                } catch (Exception e) {
                    sendJson(exchange, 500, Map.of("error", e.getMessage()));
                }
                return;
            }

            // Expected format: /v1/kv/{key}
            String prefix = "/v1/kv/";
            if (!path.startsWith(prefix) || path.length() <= prefix.length()) {
                sendJson(exchange, 400, Map.of("error", "Key path missing in URL: /v1/kv/{key}"));
                return;
            }

            String key = path.substring(prefix.length());

            String clientId = exchange.getRequestHeaders().getFirst("X-Client-Id");
            if (clientId == null || clientId.isBlank()) {
                clientId = UUID.randomUUID().toString();
            }

            String seqHeader = exchange.getRequestHeaders().getFirst("X-Sequence-Number");
            long seqNum = (seqHeader != null) ? Long.parseLong(seqHeader) : System.nanoTime();

            try {
                if ("PUT".equalsIgnoreCase(method)) {
                    byte[] valueBytes = exchange.getRequestBody().readAllBytes();
                    Command cmd = Command.put(key, valueBytes, clientId, seqNum);

                    ApplyResult result = raftNode.execute(cmd).get(10, TimeUnit.SECONDS);
                    sendJson(exchange, 200, Map.of(
                            "status", "COMMITTED",
                            "key", key,
                            "duplicate", result.isDuplicate()
                    ));
                } else if ("DELETE".equalsIgnoreCase(method)) {
                    Command cmd = Command.delete(key, clientId, seqNum);
                    ApplyResult result = raftNode.execute(cmd).get(10, TimeUnit.SECONDS);
                    sendJson(exchange, 200, Map.of(
                            "status", "COMMITTED",
                            "key", key,
                            "deleted", true
                    ));
                } else if ("GET".equalsIgnoreCase(method)) {
                    String query = exchange.getRequestURI().getQuery();
                    boolean stale = query != null && query.contains("stale=true");

                    byte[] valueBytes;
                    if (stale) {
                        valueBytes = raftNode.readStale(key);
                    } else {
                        valueBytes = raftNode.readLinearizable(key).get(5, TimeUnit.SECONDS);
                    }

                    if (valueBytes == null) {
                        sendJson(exchange, 404, Map.of("error", "Key not found: " + key));
                    } else {
                        exchange.getResponseHeaders().set("Content-Type", "application/octet-stream");
                        exchange.sendResponseHeaders(200, valueBytes.length);
                        try (OutputStream os = exchange.getResponseBody()) {
                            os.write(valueBytes);
                        }
                    }
                } else {
                    sendJson(exchange, 405, Map.of("error", "Method not allowed: " + method));
                }
            } catch (ExecutionException e) {
                Throwable cause = e.getCause();
                if (cause instanceof NotLeaderException nle) {
                    handleNotLeader(exchange, nle.getLeaderHint());
                } else {
                    log.error("Error executing command", e);
                    sendJson(exchange, 500, Map.of("error", cause != null ? cause.getMessage() : e.getMessage()));
                }
            } catch (TimeoutException e) {
                sendJson(exchange, 504, Map.of("error", "Request timed out waiting for consensus commitment"));
            } catch (Exception e) {
                log.error("Internal server error", e);
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }

        private void handleNotLeader(HttpExchange exchange, String leaderHint) throws IOException {
            Integer leaderPort = peerHttpPorts.get(leaderHint);
            String redirectUrl = (leaderPort != null)
                    ? "http://localhost:" + leaderPort + exchange.getRequestURI().toString()
                    : null;

            if (redirectUrl != null) {
                exchange.getResponseHeaders().set("Location", redirectUrl);
            }
            sendJson(exchange, 307, Map.of(
                    "error", "Node is not the leader",
                    "leaderHint", leaderHint != null ? leaderHint : "unknown",
                    "redirectUrl", redirectUrl != null ? redirectUrl : ""
            ));
        }
    }

    private class StatusHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> status = new LinkedHashMap<>();
            status.put("nodeId", raftNode.getNodeId());
            status.put("role", raftNode.getRole().name());
            status.put("term", raftNode.getCurrentTerm());
            status.put("leaderId", raftNode.getCurrentLeaderId());
            status.put("commitIndex", raftNode.getCommitIndex());
            status.put("lastApplied", raftNode.getLastApplied());
            status.put("lastLogIndex", raftNode.getWal().getLastLogIndex());
            status.put("lastLogTerm", raftNode.getWal().getLastLogTerm());

            sendJson(exchange, 200, status);
        }
    }

    private class NodesHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            Map<String, Object> nodes = new LinkedHashMap<>();
            nodes.put("localNodeId", raftNode.getNodeId());
            nodes.put("peers", raftNode.getConfig().getPeerIds());
            nodes.put("clusterSize", raftNode.getConfig().getClusterSize());
            nodes.put("quorum", raftNode.getConfig().getQuorum());

            sendJson(exchange, 200, nodes);
        }
    }

    private class MetricsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            StringBuilder sb = new StringBuilder();
            sb.append("# HELP raft_current_term The current Raft election term\n");
            sb.append("# TYPE raft_current_term gauge\n");
            sb.append("raft_current_term{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getCurrentTerm()).append("\n");

            sb.append("# HELP raft_commit_index The highest committed log index\n");
            sb.append("# TYPE raft_commit_index gauge\n");
            sb.append("raft_commit_index{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getCommitIndex()).append("\n");

            sb.append("# HELP raft_last_applied The highest applied log index\n");
            sb.append("# TYPE raft_last_applied gauge\n");
            sb.append("raft_last_applied{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getLastApplied()).append("\n");

            sb.append("# HELP raft_is_leader Whether the node is currently leader\n");
            sb.append("# TYPE raft_is_leader gauge\n");
            sb.append("raft_is_leader{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getRole() == io.raftline.core.Role.LEADER ? 1 : 0).append("\n");

            sb.append("# HELP raft_leader_lease_valid Whether the node holds an active zero-RPC leader lease\n");
            sb.append("# TYPE raft_leader_lease_valid gauge\n");
            sb.append("raft_leader_lease_valid{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.isLeaderLeaseValid() ? 1 : 0).append("\n");

            sb.append("# HELP raft_election_total Total count of elections initiated by this node\n");
            sb.append("# TYPE raft_election_total counter\n");
            sb.append("raft_election_total{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getElectionCount()).append("\n");

            sb.append("# HELP raft_term_changes_total Total count of term transitions witnessed by this node\n");
            sb.append("# TYPE raft_term_changes_total counter\n");
            sb.append("raft_term_changes_total{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getTermChangeCount()).append("\n");

            sb.append("# HELP raft_wal_last_log_index The highest log entry index appended to disk WAL\n");
            sb.append("# TYPE raft_wal_last_log_index gauge\n");
            sb.append("raft_wal_last_log_index{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getWal().getLastLogIndex()).append("\n");

            sb.append("# HELP raft_wal_snapshot_index The highest log index covered by snapshot boundary\n");
            sb.append("# TYPE raft_wal_snapshot_index gauge\n");
            sb.append("raft_wal_snapshot_index{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getWal().getSnapshotIndex()).append("\n");

            sb.append("# HELP raft_cluster_size The total configured cluster size\n");
            sb.append("# TYPE raft_cluster_size gauge\n");
            sb.append("raft_cluster_size{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getConfig().getClusterSize()).append("\n");

            sb.append("# HELP raft_cluster_quorum Majority quorum threshold required for commits\n");
            sb.append("# TYPE raft_cluster_quorum gauge\n");
            sb.append("raft_cluster_quorum{node=\"").append(raftNode.getNodeId()).append("\"} ")
                    .append(raftNode.getConfig().getQuorum()).append("\n");

            sendPlainText(exchange, 200, sb.toString());
        }
    }

    private class AdminSnapshotHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!isAuthorized(exchange)) {
                sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                return;
            }

            if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
                sendJson(exchange, 405, Map.of("error", "Method must be POST"));
                return;
            }

            try {
                long lastApplied = raftNode.getLastApplied();
                long lastTerm = raftNode.getWal().getTermForIndex(lastApplied);

                File snapshotDir = new File(raftNode.getWal().getSnapshotIndex() > 0 ? "snapshots" : "data/snapshots");
                if (!snapshotDir.exists()) snapshotDir.mkdirs();
                File snapshotFile = new File(snapshotDir, "snapshot_" + lastApplied + ".bin");

                raftNode.getStateMachine().takeSnapshot(snapshotFile, lastApplied, lastTerm);
                raftNode.getWal().setSnapshotBoundary(lastApplied, lastTerm);

                sendJson(exchange, 200, Map.of(
                        "status", "SNAPSHOT_TAKEN",
                        "snapshotIndex", lastApplied,
                        "snapshotTerm", lastTerm,
                        "file", snapshotFile.getAbsolutePath()
                ));
            } catch (Exception e) {
                log.error("Failed to take manual snapshot", e);
                sendJson(exchange, 500, Map.of("error", e.getMessage()));
            }
        }
    }

    private class MembersHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod().toUpperCase();
            if ("GET".equals(method)) {
                sendJson(exchange, 200, Map.of(
                        "nodeId", raftNode.getNodeId(),
                        "role", raftNode.getRole().name(),
                        "leaderId", raftNode.getCurrentLeaderId() != null ? raftNode.getCurrentLeaderId() : "",
                        "clusterSize", raftNode.getConfig().getClusterSize(),
                        "quorum", raftNode.getConfig().getQuorum(),
                        "peers", raftNode.getConfig().getPeerIds()
                ));
                return;
            }

            if ("POST".equals(method)) {
                if (!isAuthorized(exchange)) {
                    sendJson(exchange, 401, Map.of("error", "Unauthorized: Valid API Key required"));
                    return;
                }
                if (raftNode.getRole() != io.raftline.core.Role.LEADER) {
                    Integer leaderPort = peerHttpPorts.get(raftNode.getCurrentLeaderId());
                    String redirectUrl = (leaderPort != null)
                            ? "http://localhost:" + leaderPort + "/v1/cluster/members"
                            : null;
                    if (redirectUrl != null) {
                        exchange.getResponseHeaders().set("Location", redirectUrl);
                    }
                    sendJson(exchange, 307, Map.of(
                            "error", "Node is not the leader",
                            "leaderHint", raftNode.getCurrentLeaderId() != null ? raftNode.getCurrentLeaderId() : "unknown",
                            "redirectUrl", redirectUrl != null ? redirectUrl : ""
                    ));
                    return;
                }

                try {
                    Map<String, Object> req = json.readValue(exchange.getRequestBody(), Map.class);
                    String memberId = (String) req.get("nodeId");
                    String action = ((String) req.getOrDefault("action", "ADD")).toUpperCase();

                    if (memberId == null || memberId.isBlank()) {
                        sendJson(exchange, 400, Map.of("error", "nodeId is required"));
                        return;
                    }

                    boolean ok;
                    if ("ADD".equals(action)) {
                        ok = raftNode.addPeer(memberId);
                    } else if ("REMOVE".equals(action)) {
                        ok = raftNode.removePeer(memberId);
                    } else {
                        sendJson(exchange, 400, Map.of("error", "action must be ADD or REMOVE"));
                        return;
                    }

                    sendJson(exchange, 200, Map.of(
                            "success", ok,
                            "action", action,
                            "nodeId", memberId,
                            "clusterSize", raftNode.getConfig().getClusterSize(),
                            "quorum", raftNode.getConfig().getQuorum(),
                            "peers", raftNode.getConfig().getPeerIds()
                    ));
                } catch (Exception e) {
                    log.error("Failed to update membership", e);
                    sendJson(exchange, 500, Map.of("error", e.getMessage()));
                }
                return;
            }

            sendJson(exchange, 405, Map.of("error", "Method not allowed: " + method));
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
