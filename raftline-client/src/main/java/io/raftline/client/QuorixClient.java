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
    private final AtomicLong sequenceGenerator = new AtomicLong(0);

    private volatile String cachedLeaderUrl = null;

    public QuorixClient(List<String> seedUrls) {
        if (seedUrls == null || seedUrls.isEmpty()) {
            throw new IllegalArgumentException("At least one seed URL must be provided");
        }
        this.seedUrls = new ArrayList<>(seedUrls);
        this.clientId = "client-" + UUID.randomUUID();
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER) // Manually handled for leader caching
                .build();
    }

    public static QuorixClient create(String... seedUrls) {
        return new QuorixClient(List.of(seedUrls));
    }

    public void put(String key, String value) throws IOException, InterruptedException {
        put(key, value.getBytes(StandardCharsets.UTF_8));
    }

    public void put(String key, byte[] value) throws IOException, InterruptedException {
        long seq = sequenceGenerator.incrementAndGet();
        executeWithRetry((baseUrl) -> {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/kv/" + key))
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
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(uriStr))
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

    public void delete(String key) throws IOException, InterruptedException {
        long seq = sequenceGenerator.incrementAndGet();
        executeWithRetry((baseUrl) -> {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/v1/kv/" + key))
                    .header("X-Client-Id", clientId)
                    .header("X-Sequence-Number", String.valueOf(seq))
                    .DELETE()
                    .timeout(Duration.ofSeconds(5))
                    .build();
            return httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
        });
    }

    public JsonNode getClusterStatus(String targetUrl) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(targetUrl + "/v1/cluster/status"))
                .GET()
                .build();
        HttpResponse<String> res = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        return json.readTree(res.body());
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

                    // 3. Not leader redirect (307)
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

    public String getClientId() {
        return clientId;
    }

    @Override
    public void close() {
        // HttpClient handles lifecycle
    }
}
