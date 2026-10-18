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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
    private final Map<String, Integer> peerHttpPorts;
    private final String apiKey;
    private final HttpServer server;

    public RaftHttpServer(int port, RaftNode raftNode, Map<String, Integer> peerHttpPorts) throws IOException {
        this(port, raftNode, peerHttpPorts, null);
    }

    public RaftHttpServer(int port, RaftNode raftNode, Map<String, Integer> peerHttpPorts, String apiKey) throws IOException {
        this.port = port;
        this.raftNode = raftNode;
        this.peerHttpPorts = peerHttpPorts != null ? peerHttpPorts : Map.of();
        this.apiKey = (apiKey != null && !apiKey.isBlank()) ? apiKey.trim() : null;

        this.server = HttpServer.create(new InetSocketAddress(port), 0);
        this.server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());

        setupRoutes();
    }

    public void start() {
        server.start();
        log.info("Raft REST API Server listening on port {} (Auth={})", port, (apiKey != null ? "ENABLED" : "DISABLED"));
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
        server.createContext("/v1/metrics", new MetricsHandler());
        server.createContext("/v1/admin/snapshot", new AdminSnapshotHandler());
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
