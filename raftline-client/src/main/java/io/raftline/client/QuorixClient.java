package io.raftline.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/**
 * High-performance, fault-tolerant Java client for Raftline.
 * Automatically discovers leaders, follows redirects, retries across cluster nodes,
 * and maintains client sequence IDs for exactly-once idempotency.
 */
public class QuorixClient implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(QuorixClient.class);
    private static final ObjectMapper json = new ObjectMapper();

    private final List<String> seedUrls;
    private final HttpClient httpClient;
    private final String clientId;
    private final String apiKey;
    private final AtomicLong sequenceGenerator = new AtomicLong(0);

    private volatile String cachedLeaderUrl = null;

    public QuorixClient(List<String> seedUrls) {
        this(seedUrls, null);
    }

    public QuorixClient(List<String> seedUrls, String apiKey) {
        if (seedUrls == null || seedUrls.isEmpty()) {
            throw new IllegalArgumentException("At least one seed URL must be provided");
        }
        this.seedUrls = new ArrayList<>(seedUrls);
        this.apiKey = (apiKey != null && !apiKey.isBlank()) ? apiKey.trim() : null;
        this.clientId = "client-" + UUID.randomUUID();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER) // Manually handled for leader caching
                .build();
    }

    public static QuorixClient create(String... seedUrls) {
        return new QuorixClient(List.of(seedUrls));
    }

    public static QuorixClient createWithApiKey(String apiKey, String... seedUrls) {
        return new QuorixClient(List.of(seedUrls), apiKey);
    }

    private HttpRequest.Builder newRequestBuilder(URI uri) {
        HttpRequest.Builder builder = HttpRequest.newBuilder().uri(uri);
        if (apiKey != null) {
            builder.header("Authorization", "Bearer " + apiKey);
        }
        return builder;
    }

    public void put(String key, String value) throws IOException, InterruptedException {
        put(key, value.getBytes(StandardCharsets.UTF_8));
    }

    public void put(String key, byte[] value) throws IOException, InterruptedException {
        long seq = sequenceGenerator.incrementAndGet();
        executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/kv/" + key))
                    .header("Content-Type", "application/octet-stream")
                    .header("X-Client-Id", clientId)
                    .header("X-Sequence-Number", String.valueOf(seq))
                    .PUT(HttpRequest.BodyPublishers.ofByteArray(value))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
    }

    public String getString(String key) throws IOException, InterruptedException {
        byte[] val = get(key, false);
        return val != null ? new String(val, StandardCharsets.UTF_8) : null;
    }

    public byte[] get(String key) throws IOException, InterruptedException {
        return get(key, false);
    }

    public byte[] get(String key, boolean stale) throws IOException, InterruptedException {
        HttpResponse<byte[]> response = executeWithRetry((baseUrl) -> {
            String uriStr = baseUrl + "/v1/kv/" + key + (stale ? "?stale=true" : "");
            HttpRequest request = newRequestBuilder(URI.create(uriStr))
                    .GET()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });

        if (response.statusCode() == 404) {
            return null;
        }
        if (response.statusCode() != 200) {
            throw new IOException("GET failed with HTTP " + response.statusCode() + ": " + new String(response.body()));
        }
        return response.body();
    }

    public java.util.Map<String, String> scan(String fromKey, String toKey, int limit) throws IOException, InterruptedException {
        StringBuilder urlBuilder = new StringBuilder("/v1/kv/scan?");
        if (fromKey != null && !fromKey.isEmpty()) {
            urlBuilder.append("from=").append(java.net.URLEncoder.encode(fromKey, StandardCharsets.UTF_8)).append("&");
        }
        if (toKey != null && !toKey.isEmpty()) {
            urlBuilder.append("to=").append(java.net.URLEncoder.encode(toKey, StandardCharsets.UTF_8)).append("&");
        }
        urlBuilder.append("limit=").append(limit > 0 ? limit : 100);

        String path = urlBuilder.toString();
        HttpResponse<byte[]> response = executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + path))
                    .GET()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });

        if (response.statusCode() != 200) {
            throw new IOException("Scan failed with HTTP " + response.statusCode() + ": " + new String(response.body()));
        }

        JsonNode root = json.readTree(response.body());
        JsonNode dataNode = root.get("data");
        java.util.Map<String, String> result = new java.util.LinkedHashMap<>();
        if (dataNode != null && dataNode.isObject()) {
            dataNode.fields().forEachRemaining(entry -> result.put(entry.getKey(), entry.getValue().asText()));
        }
        return result;
    }

    public void delete(String key) throws IOException, InterruptedException {
        long seq = sequenceGenerator.incrementAndGet();
        executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/kv/" + key))
                    .header("X-Client-Id", clientId)
                    .header("X-Sequence-Number", String.valueOf(seq))
                    .DELETE()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
    }

    public void putBatch(Map<String, String> entries) throws IOException, InterruptedException {
        if (entries == null || entries.isEmpty()) return;

        List<Map<String, String>> ops = new ArrayList<>();
        for (Map.Entry<String, String> entry : entries.entrySet()) {
            ops.add(Map.of("op", "PUT", "key", entry.getKey(), "value", entry.getValue()));
        }

        String body = json.writeValueAsString(ops);
        HttpResponse<byte[]> response = executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/kv/batch"))
                    .header("Content-Type", "application/json")
                    .header("X-Client-Id", clientId)
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(15))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });

        if (response.statusCode() != 200) {
            throw new IOException("Batch operation failed with HTTP " + response.statusCode() + ": " + new String(response.body()));
        }
    }

    public JsonNode getClusterStatus(String targetUrl) throws IOException, InterruptedException {
        HttpRequest request = newRequestBuilder(URI.create(targetUrl + "/v1/cluster/status"))
                .GET()
                .build();
        HttpResponse<String> res = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        return json.readTree(res.body());
    }

    public String getMetrics(String targetUrl) throws IOException, InterruptedException {
        HttpRequest request = newRequestBuilder(URI.create(targetUrl + "/v1/metrics"))
                .GET()
                .build();
        HttpResponse<String> res = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        return res.body();
    }

    public void addMember(String nodeId) throws IOException, InterruptedException {
        String body = json.writeValueAsString(Map.of("nodeId", nodeId, "action", "ADD"));
        executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/cluster/members"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
    }

    public void removeMember(String nodeId) throws IOException, InterruptedException {
        String body = json.writeValueAsString(Map.of("nodeId", nodeId, "action", "REMOVE"));
        executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/cluster/members"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
    }

    public JsonNode getMembers() throws IOException, InterruptedException {
        HttpResponse<byte[]> response = executeWithRetry((baseUrl) -> {
            HttpRequest request = newRequestBuilder(URI.create(baseUrl + "/v1/cluster/members"))
                    .GET()
                    .timeout(Duration.ofSeconds(3))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
        return json.readTree(response.body());
    }

    @FunctionalInterface
    private interface HttpAction {
        HttpResponse<byte[]> execute(String baseUrl) throws Exception;
    }

    private HttpResponse<byte[]> executeWithRetry(HttpAction action) throws IOException, InterruptedException {
        int maxAttempts = 10;
        long backoffMs = 100;

        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            List<String> targets = getCandidateUrls();

            for (String baseUrl : targets) {
                try {
                    HttpResponse<byte[]> response = action.execute(baseUrl);

                    // 1. Success!
                    if (response.statusCode() >= 200 && response.statusCode() < 300) {
                        this.cachedLeaderUrl = baseUrl;
                        return response;
                    }

                    // 2. 404 Key not found is a valid business response
                    if (response.statusCode() == 404) {
                        this.cachedLeaderUrl = baseUrl;
                        return response;
                    }

                    // 3. 401 Unauthorized is fatal - do not retry
                    if (response.statusCode() == 401) {
                        throw new IOException("HTTP 401 Unauthorized: Valid API key required for cluster access");
                    }

                    // 4. Not leader redirect (307)
                    if (response.statusCode() == 307) {
                        String location = response.headers().firstValue("Location").orElse(null);
                        if (location != null && !location.isBlank()) {
                            URI locUri = URI.create(location);
                            this.cachedLeaderUrl = locUri.getScheme() + "://" + locUri.getAuthority();
                            log.debug("Redirected to leader at {}", this.cachedLeaderUrl);
                            break; // Retry immediately with updated leader
                        }
                    }

                    log.warn("Node {} returned HTTP {}. Trying next...", baseUrl, response.statusCode());
                } catch (IOException e) {
                    if (e.getMessage() != null && e.getMessage().contains("401 Unauthorized")) {
                        throw e;
                    }
                    log.debug("Failed contacting {}: {}", baseUrl, e.getMessage());
                } catch (Exception e) {
                    log.debug("Failed contacting {}: {}", baseUrl, e.getMessage());
                }
            }

            Thread.sleep(backoffMs);
            backoffMs = Math.min(backoffMs * 2, 1000);
        }

        throw new IOException("Failed to execute request after " + maxAttempts + " attempts across cluster nodes");
    }

    private List<String> getCandidateUrls() {
        List<String> urls = new ArrayList<>();
        if (cachedLeaderUrl != null) {
            urls.add(cachedLeaderUrl);
        }
        for (String seed : seedUrls) {
            if (!urls.contains(seed)) {
                urls.add(seed);
            }
        }
        return urls;
    }

    public String getShards(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cluster/shards"))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.body();
    }

    public String splitShard(String targetUrl, String originalShardId, String splitKey, String newLeftShardId, String newRightShardId) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "action", "SPLIT",
                "originalShardId", originalShardId,
                "splitKey", splitKey,
                "newLeftShardId", newLeftShardId,
                "newRightShardId", newRightShardId
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cluster/shards"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.body();
    }

    public String rebalanceShard(String targetUrl, String shardId, List<String> newReplicas) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "action", "REBALANCE",
                "shardId", shardId,
                "replicas", newReplicas
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cluster/shards"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.body();
    }

    public String executeTransaction(String targetUrl, Map<String, String> writes) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        byte[] payload = json.writeValueAsBytes(writes);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/txn"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.body();
    }

    public io.raftline.core.agent.AgentLockInfo acquireAgentLock(String targetUrl, String resource, String agentId, long ttlMs) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "resource", resource,
                "agentId", agentId,
                "ttlMs", ttlMs
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/lock/acquire"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                cachedLeaderUrl = redirectUrl.substring(0, redirectUrl.indexOf("/v1/"));
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }
        if (response.statusCode() == 200) {
            JsonNode tree = json.readTree(response.body());
            return new io.raftline.core.agent.AgentLockInfo(
                    tree.get("resource").asText(),
                    tree.get("ownerAgentId").asText(),
                    tree.get("fencingToken").asLong(),
                    tree.get("acquiredAtEpochMs").asLong(),
                    tree.get("expiresAtEpochMs").asLong()
            );
        }
        return null;
    }

    public io.raftline.core.agent.AgentLockInfo renewAgentLock(String targetUrl, String resource, String agentId, long fencingToken, long extendTtlMs) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "resource", resource,
                "agentId", agentId,
                "fencingToken", fencingToken,
                "extendTtlMs", extendTtlMs
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/lock/renew"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                cachedLeaderUrl = redirectUrl.substring(0, redirectUrl.indexOf("/v1/"));
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }
        if (response.statusCode() == 200) {
            JsonNode tree = json.readTree(response.body());
            return new io.raftline.core.agent.AgentLockInfo(
                    tree.get("resource").asText(),
                    tree.get("ownerAgentId").asText(),
                    tree.get("fencingToken").asLong(),
                    System.currentTimeMillis(),
                    tree.get("expiresAtEpochMs").asLong()
            );
        }
        return null;
    }

    public boolean releaseAgentLock(String targetUrl, String resource, String agentId, long fencingToken) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "resource", resource,
                "agentId", agentId,
                "fencingToken", fencingToken
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/lock/release"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                cachedLeaderUrl = redirectUrl.substring(0, redirectUrl.indexOf("/v1/"));
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }
        return response.statusCode() == 200;
    }

    public io.raftline.core.agent.AgentLockInfo getAgentLock(String targetUrl, String resource) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        String encodedResource = java.net.URLEncoder.encode(resource, StandardCharsets.UTF_8);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/lock?resource=" + encodedResource))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                request = newRequestBuilder(URI.create(redirectUrl))
                        .GET()
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }
        if (response.statusCode() == 200) {
            JsonNode tree = json.readTree(response.body());
            return new io.raftline.core.agent.AgentLockInfo(
                    tree.get("resource").asText(),
                    tree.get("ownerAgentId").asText(),
                    tree.get("fencingToken").asLong(),
                    tree.get("acquiredAtEpochMs").asLong(),
                    tree.get("expiresAtEpochMs").asLong()
            );
        }
        log.warn("getAgentLock failed: status={}, body={}", response.statusCode(), response.body());
        return null;
    }

    public static record CasResult(boolean success, long version, String currentValue, int statusCode) {}

    public static record AgentState(String key, String value, long version) {}

    /**
     * Executes atomic Compare-And-Swap on a key.
     *
     * @param targetUrl Target HTTP URL (or null for auto leader)
     * @param key Key to update
     * @param expectedVersion Expected monotonic version (0 if expecting key not to exist)
     * @param newValue String value to store
     * @param agentId Unique agent ID
     * @return CasResult indicating success or version mismatch
     */
    public CasResult compareAndSwap(String targetUrl, String key, long expectedVersion, String newValue, String agentId) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "key", key,
                "expectedVersion", expectedVersion,
                "value", newValue,
                "agentId", agentId != null ? agentId : clientId
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/cas"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                cachedLeaderUrl = redirectUrl.substring(0, redirectUrl.indexOf("/v1/"));
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }

        if (response.statusCode() == 200) {
            JsonNode node = json.readTree(response.body());
            return new CasResult(true, node.get("version").asLong(), newValue, 200);
        } else if (response.statusCode() == 409) {
            JsonNode node = json.readTree(response.body());
            long actualVersion = node.has("actualVersion") ? node.get("actualVersion").asLong() : 0L;
            String curVal = node.has("currentValue") ? node.get("currentValue").asText() : "";
            return new CasResult(false, actualVersion, curVal, 409);
        }
        return new CasResult(false, -1, response.body(), response.statusCode());
    }

    /**
     * Reads agent shared memory key with its monotonic version.
     */
    public AgentState getAgentState(String targetUrl, String key) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        String encodedKey = java.net.URLEncoder.encode(key, StandardCharsets.UTF_8);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/agent/state?key=" + encodedKey))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                request = newRequestBuilder(URI.create(redirectUrl))
                        .GET()
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }

        if (response.statusCode() == 200) {
            JsonNode node = json.readTree(response.body());
            return new AgentState(node.get("key").asText(), node.get("value").asText(), node.get("version").asLong());
        }
        return null;
    }

    public static record StreamWatchEvent(String type, String key, String value, long version, long logIndex, long timestamp) {}

    public interface WatchEventListener {
        void onEvent(StreamWatchEvent event);
        default void onError(Throwable error) {}
    }

    public interface WatchSubscription extends AutoCloseable {
        @Override
        void close();
    }

    /**
     * Subscribes to a reactive Server-Sent Events (SSE) watch stream for a key or prefix.
     */
    public WatchSubscription watch(String targetUrl, String keyOrPrefix, boolean isPrefix, long sinceVersion, WatchEventListener listener) {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        String param = isPrefix ? "prefix=" + java.net.URLEncoder.encode(keyOrPrefix, StandardCharsets.UTF_8)
                : "key=" + java.net.URLEncoder.encode(keyOrPrefix, StandardCharsets.UTF_8);
        if (sinceVersion > 0) {
            param += "&sinceVersion=" + sinceVersion;
        }

        URI uri = URI.create(base + "/v1/agent/watch?" + param);
        HttpRequest request = newRequestBuilder(uri)
                .GET()
                .header("Accept", "text/event-stream")
                .timeout(Duration.ofMinutes(60))
                .build();

        java.util.concurrent.atomic.AtomicBoolean active = new java.util.concurrent.atomic.AtomicBoolean(true);
        Thread thread = Thread.ofVirtual().start(() -> {
            try {
                httpClient.send(request, HttpResponse.BodyHandlers.fromLineSubscriber(new java.util.concurrent.Flow.Subscriber<String>() {
                    private java.util.concurrent.Flow.Subscription sub;

                    @Override
                    public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) {
                        this.sub = subscription;
                        subscription.request(Long.MAX_VALUE);
                    }

                    @Override
                    public void onNext(String line) {
                        if (!active.get()) {
                            if (sub != null) sub.cancel();
                            return;
                        }
                        if (line.startsWith("data: ")) {
                            String data = line.substring("data: ".length()).trim();
                            if (data.startsWith("{") && data.contains("\"key\"")) {
                                try {
                                    JsonNode node = json.readTree(data);
                                    StreamWatchEvent evt = new StreamWatchEvent(
                                            node.has("type") ? node.get("type").asText() : "PUT",
                                            node.has("key") ? node.get("key").asText() : "",
                                            node.has("value") ? node.get("value").asText() : "",
                                            node.has("version") ? node.get("version").asLong() : 0L,
                                            node.has("logIndex") ? node.get("logIndex").asLong() : 0L,
                                            node.has("timestamp") ? node.get("timestamp").asLong() : 0L
                                    );
                                    listener.onEvent(evt);
                                } catch (Exception e) {
                                    log.debug("Failed parsing watch event json: {}", e.getMessage());
                                }
                            }
                        }
                    }

                    @Override
                    public void onError(Throwable throwable) {
                        if (active.get()) {
                            listener.onError(throwable);
                        }
                    }

                    @Override
                    public void onComplete() {
                    }
                }));
            } catch (Exception e) {
                if (active.get()) {
                    listener.onError(e);
                }
            }
        });

        return () -> {
            active.set(false);
            thread.interrupt();
        };
    }

    public static record ClientCdcEvent(
            long eventId,
            long logIndex,
            long logTerm,
            String operation,
            String key,
            String payload,
            long version,
            long timestamp
    ) {}

    public static record CdcPollResult(long sinceLogIndex, long highestLogIndex, int count, List<ClientCdcEvent> events) {}

    /**
     * Polls committed Change Data Capture (CDC) events strictly after sinceLogIndex.
     */
    public CdcPollResult pollCdcEvents(String targetUrl, long sinceLogIndex, int limit) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        String url = base + "/v1/cdc/events?sinceLogIndex=" + sinceLogIndex + "&limit=" + limit;

        HttpRequest request = newRequestBuilder(URI.create(url))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                request = newRequestBuilder(URI.create(redirectUrl))
                        .GET()
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }

        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            long since = root.get("sinceLogIndex").asLong();
            long highest = root.get("highestLogIndex").asLong();
            int count = root.get("count").asInt();

            List<ClientCdcEvent> evts = new ArrayList<>();
            if (root.has("events")) {
                for (JsonNode n : root.get("events")) {
                    evts.add(new ClientCdcEvent(
                            n.get("eventId").asLong(),
                            n.get("logIndex").asLong(),
                            n.get("logTerm").asLong(),
                            n.get("operation").asText(),
                            n.get("key").asText(),
                            n.get("payload").asText(),
                            n.get("version").asLong(),
                            n.get("timestamp").asLong()
                    ));
                }
            }
            return new CdcPollResult(since, highest, count, evts);
        }
        throw new IOException("Failed to poll CDC events: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Acknowledges consumer progress watermark for CDC log truncation/compaction.
     */
    public long ackCdcWatermark(String targetUrl, String consumerId, long logIndex) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "consumerId", consumerId,
                "logIndex", logIndex
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/ack"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }

        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            return root.get("watermark").asLong();
        }
        throw new IOException("Failed to ack CDC watermark: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Atomically sends a Transactional Outbox record through consensus.
     */
    public boolean sendOutboxEvent(String targetUrl, String aggregateType, String aggregateId, String eventPayload) throws IOException, InterruptedException {
        String outboxKey = "__sys:outbox:" + aggregateType + ":" + aggregateId + ":" + System.nanoTime();
        put(outboxKey, eventPayload);
        return true;
    }

    public static record WebhookInfo(
            String id,
            String targetUrl,
            String prefixFilter,
            List<String> operations,
            boolean hasSecret,
            int maxRetries,
            long createdEpochMs,
            long deliveredCount,
            long failedCount
    ) {}

    public static record DeadLetterRecord(
            String deadLetterId,
            String subscriptionId,
            String targetUrl,
            String failureReason,
            int attempts,
            long failedAt,
            ClientCdcEvent event
    ) {}

    /**
     * Registers a webhook subscription with key prefix filtering and optional secret signing.
     */
    public WebhookInfo registerWebhook(String targetUrl, String destinationUrl, String prefix, String secret) throws IOException, InterruptedException {
        return registerWebhook(targetUrl, destinationUrl, prefix, List.of(), secret, 3);
    }

    /**
     * Registers a webhook subscription with key prefix, operation filter, HMAC secret signing, and max retries.
     */
    public WebhookInfo registerWebhook(String targetUrl, String destinationUrl, String prefix, List<String> operations, String secret, int maxRetries) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = new HashMap<>();
        body.put("targetUrl", destinationUrl);
        if (prefix != null && !prefix.isBlank()) body.put("prefix", prefix);
        if (operations != null && !operations.isEmpty()) body.put("operations", operations);
        if (secret != null && !secret.isBlank()) body.put("secret", secret);
        body.put("maxRetries", maxRetries);

        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/webhooks"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 307) {
            String redirectUrl = response.headers().firstValue("Location").orElse(null);
            if (redirectUrl != null) {
                request = newRequestBuilder(URI.create(redirectUrl))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                        .timeout(Duration.ofSeconds(5))
                        .build();
                response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            }
        }

        if (response.statusCode() == 201) {
            JsonNode root = json.readTree(response.body());
            JsonNode w = root.get("webhook");
            List<String> ops = new ArrayList<>();
            if (w.has("operations")) {
                for (JsonNode opNode : w.get("operations")) ops.add(opNode.asText());
            }
            return new WebhookInfo(
                    w.get("id").asText(),
                    w.get("targetUrl").asText(),
                    w.get("prefixFilter").asText(),
                    ops,
                    w.get("hasSecret").asBoolean(),
                    w.get("maxRetries").asInt(),
                    w.get("createdEpochMs").asLong(),
                    w.get("deliveredCount").asLong(),
                    w.get("failedCount").asLong()
            );
        }
        throw new IOException("Failed to register webhook: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Lists all registered webhooks and their delivery metrics.
     */
    public List<WebhookInfo> listWebhooks(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/webhooks"))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            List<WebhookInfo> result = new ArrayList<>();
            if (root.has("webhooks")) {
                for (JsonNode w : root.get("webhooks")) {
                    List<String> ops = new ArrayList<>();
                    if (w.has("operations")) {
                        for (JsonNode opNode : w.get("operations")) ops.add(opNode.asText());
                    }
                    result.add(new WebhookInfo(
                            w.get("id").asText(),
                            w.get("targetUrl").asText(),
                            w.get("prefixFilter").asText(),
                            ops,
                            w.get("hasSecret").asBoolean(),
                            w.get("maxRetries").asInt(),
                            w.get("createdEpochMs").asLong(),
                            w.get("deliveredCount").asLong(),
                            w.get("failedCount").asLong()
                    ));
                }
            }
            return result;
        }
        throw new IOException("Failed to list webhooks: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Unregisters a webhook subscription.
     */
    public boolean deleteWebhook(String targetUrl, String subscriptionId) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/webhooks?id=" + subscriptionId))
                .DELETE()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.statusCode() == 200;
    }

    /**
     * Retrieves dead-letter queue records for failed webhook deliveries.
     */
    public List<DeadLetterRecord> getDeadLetterQueue(String targetUrl, int limit) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/dlq?limit=" + limit))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            List<DeadLetterRecord> list = new ArrayList<>();
            if (root.has("records")) {
                for (JsonNode r : root.get("records")) {
                    ClientCdcEvent evt = null;
                    if (r.has("event") && !r.get("event").isNull()) {
                        JsonNode n = r.get("event");
                        evt = new ClientCdcEvent(
                                n.get("eventId").asLong(),
                                n.get("logIndex").asLong(),
                                n.get("logTerm").asLong(),
                                n.get("operation").asText(),
                                n.get("key").asText(),
                                n.get("payload").asText(),
                                n.get("version").asLong(),
                                n.get("timestamp").asLong()
                        );
                    }
                    list.add(new DeadLetterRecord(
                            r.get("deadLetterId").asText(),
                            r.get("subscriptionId").asText(),
                            r.get("targetUrl").asText(),
                            r.get("failureReason").asText(),
                            r.get("attempts").asInt(),
                            r.get("failedAt").asLong(),
                            evt
                    ));
                }
            }
            return list;
        }
        throw new IOException("Failed to get DLQ: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Clears all dead-letter records from the queue.
     */
    public boolean clearDeadLetterQueue(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cdc/dlq"))
                .DELETE()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.statusCode() == 200;
    }

    public static record ClientIndexInfo(
            String name,
            String keyPrefix,
            String field,
            String type,
            long createdEpochMs,
            int indexedKeysCount,
            int uniqueValuesCount
    ) {}

    public static record ClientDocumentMatch(String key, JsonNode value) {}

    public static record ClientQueryResult(
            int totalMatched,
            int returnedCount,
            boolean usedIndex,
            long executionTimeMs,
            List<ClientDocumentMatch> results
    ) {}

    /**
     * Registers a secondary index on a JSON field.
     */
    public ClientIndexInfo createIndex(String targetUrl, String name, String keyPrefix, String field, String type) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        Map<String, Object> body = Map.of(
                "name", name,
                "prefix", (keyPrefix != null) ? keyPrefix : "",
                "field", field,
                "type", (type != null) ? type.toUpperCase() : "STRING"
        );
        byte[] payload = json.writeValueAsBytes(body);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/index"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 201) {
            JsonNode root = json.readTree(response.body());
            JsonNode idx = root.get("index");
            return new ClientIndexInfo(
                    idx.get("name").asText(),
                    idx.get("keyPrefix").asText(),
                    idx.get("field").asText(),
                    idx.get("type").asText(),
                    idx.get("createdEpochMs").asLong(),
                    idx.get("indexedKeysCount").asInt(),
                    idx.get("uniqueValuesCount").asInt()
            );
        }
        throw new IOException("Failed to create index: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Lists all registered secondary indexes and statistics.
     */
    public List<ClientIndexInfo> listIndexes(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/index"))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            List<ClientIndexInfo> list = new ArrayList<>();
            if (root.has("indexes")) {
                for (JsonNode idx : root.get("indexes")) {
                    list.add(new ClientIndexInfo(
                            idx.get("name").asText(),
                            idx.get("keyPrefix").asText(),
                            idx.get("field").asText(),
                            idx.get("type").asText(),
                            idx.get("createdEpochMs").asLong(),
                            idx.get("indexedKeysCount").asInt(),
                            idx.get("uniqueValuesCount").asInt()
                    ));
                }
            }
            return list;
        }
        throw new IOException("Failed to list indexes: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Drops a secondary index by name.
     */
    public boolean dropIndex(String targetUrl, String indexName) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/index?name=" + indexName))
                .DELETE()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return response.statusCode() == 200;
    }

    /**
     * Queries documents using JSON criteria, filter predicates, and secondary indexes.
     */
    public ClientQueryResult queryDocuments(String targetUrl, Map<String, Object> queryMap) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        byte[] payload = json.writeValueAsBytes(queryMap);
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/query"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            JsonNode root = json.readTree(response.body());
            int total = root.get("totalMatched").asInt();
            int returned = root.get("returnedCount").asInt();
            boolean usedIdx = root.get("usedIndex").asBoolean();
            long timeMs = root.get("executionTimeMs").asLong();

            List<ClientDocumentMatch> matches = new ArrayList<>();
            if (root.has("results")) {
                for (JsonNode item : root.get("results")) {
                    matches.add(new ClientDocumentMatch(
                            item.get("key").asText(),
                            item.has("value") ? item.get("value") : null
                    ));
                }
            }
            return new ClientQueryResult(total, returned, usedIdx, timeMs, matches);
        }
        throw new IOException("Failed to query documents: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Convenience query matching a single field predicate.
     */
    public ClientQueryResult queryByField(String targetUrl, String prefix, String field, String op, Object value, boolean includeValues) throws IOException, InterruptedException {
        Map<String, Object> query = new HashMap<>();
        query.put("prefix", prefix != null ? prefix : "");
        query.put("filter", Map.of(
                "field", field,
                "op", op != null ? op : "EQ",
                "value", value
        ));
        query.put("includeValues", includeValues);
        return queryDocuments(targetUrl, query);
    }

    /**
     * Retrieves aggregated cluster overview and telemetry for the visual dashboard.
     */
    public JsonNode getClusterOverview(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/cluster/overview"))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            return json.readTree(response.body());
        }
        throw new IOException("Failed to get cluster overview: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Injects a disaster scenario or custom fault into a target node.
     */
    public JsonNode injectChaos(String targetUrl, String jsonPayload) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/chaos/inject"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(jsonPayload, StandardCharsets.UTF_8))
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            return json.readTree(response.body());
        }
        throw new IOException("Failed to inject chaos: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Heals an isolated peer or restores all network faults on a target node.
     */
    public JsonNode healChaos(String targetUrl, String peerId) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        String uri = (peerId != null && !peerId.isBlank())
                ? base + "/v1/chaos/heal?peer=" + java.net.URLEncoder.encode(peerId, StandardCharsets.UTF_8)
                : base + "/v1/chaos/heal?all=true";
        HttpRequest request = newRequestBuilder(URI.create(uri))
                .POST(HttpRequest.BodyPublishers.noBody())
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            return json.readTree(response.body());
        }
        throw new IOException("Failed to heal chaos: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * 1-Click Heal: clears all network partitions, delays, drops, and unpauses nodes.
     */
    public JsonNode healAllChaos(String targetUrl) throws IOException, InterruptedException {
        return healChaos(targetUrl, null);
    }

    /**
     * Retrieves current chaos status and fault state on the target node.
     */
    public JsonNode getChaosStatus(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/chaos/status"))
                .GET()
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            return json.readTree(response.body());
        }
        throw new IOException("Failed to get chaos status: status=" + response.statusCode() + ", body=" + response.body());
    }

    /**
     * Triggers an automated self-healing and consensus invariant probe on the cluster.
     */
    public JsonNode verifyClusterHealth(String targetUrl) throws IOException, InterruptedException {
        String base = (targetUrl != null && !targetUrl.isBlank()) ? targetUrl : (cachedLeaderUrl != null ? cachedLeaderUrl : seedUrls.get(0));
        HttpRequest request = newRequestBuilder(URI.create(base + "/v1/chaos/verify"))
                .POST(HttpRequest.BodyPublishers.noBody())
                .timeout(Duration.ofSeconds(5))
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() == 200) {
            return json.readTree(response.body());
        }
        throw new IOException("Failed to verify cluster health: status=" + response.statusCode() + ", body=" + response.body());
    }

    public String getClientId() {
        return clientId;
    }

    @Override
    public void close() {
        // HttpClient handles lifecycle
    }
}

