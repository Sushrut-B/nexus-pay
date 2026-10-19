package io.raftline.core.webhook;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.cdc.CdcEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.Closeable;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native, non-blocking Webhook Dispatcher and External Sink Router.
 *
 * Subscribes to committed CDC state transitions and reliably dispatches webhook payloads
 * to external HTTP endpoints with prefix/operation filtering, HMAC-SHA256 signature verification,
 * exponential backoff retries, and a bounded Dead-Letter Queue (DLQ).
 */
public class WebhookDispatcher implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(WebhookDispatcher.class);
    private static final ObjectMapper json = new ObjectMapper();

    private static final int DEFAULT_MAX_DLQ_CAPACITY = 5_000;
    private static final long DEFAULT_RETRY_BASE_MS = 50L;

    private final ConcurrentMap<String, WebhookSubscription> subscriptions = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<DeadLetterEvent> deadLetterQueue = new ConcurrentLinkedDeque<>();

    private final HttpClient httpClient;
    private final ExecutorService executor;
    private final long retryBaseMs;
    private final int maxDlqCapacity;
    private final AtomicBoolean running = new AtomicBoolean(true);

    public WebhookDispatcher() {
        this(HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .build(),
                DEFAULT_RETRY_BASE_MS,
                DEFAULT_MAX_DLQ_CAPACITY);
    }

    public WebhookDispatcher(HttpClient httpClient, long retryBaseMs, int maxDlqCapacity) {
        this.httpClient = Objects.requireNonNull(httpClient, "httpClient");
        this.retryBaseMs = Math.max(10L, retryBaseMs);
        this.maxDlqCapacity = Math.max(100, maxDlqCapacity);
        this.executor = Executors.newVirtualThreadPerTaskExecutor();
    }

    /**
     * Registers a new webhook subscription.
     */
    public WebhookSubscription registerSubscription(WebhookSubscription subscription) {
        Objects.requireNonNull(subscription, "subscription");
        subscriptions.put(subscription.getId(), subscription);
        log.info("Registered webhook subscription id={} targetUrl={} prefix='{}' operations={}",
                subscription.getId(), subscription.getTargetUrl(), subscription.getPrefixFilter(), subscription.getOperations());
        return subscription;
    }

    /**
     * Unregisters a webhook subscription by ID.
     */
    public boolean unregisterSubscription(String subscriptionId) {
        if (subscriptionId == null) {
            return false;
        }
        boolean removed = subscriptions.remove(subscriptionId) != null;
        if (removed) {
            log.info("Unregistered webhook subscription id={}", subscriptionId);
        }
        return removed;
    }

    /**
     * Gets a registered subscription by ID.
     */
    public WebhookSubscription getSubscription(String subscriptionId) {
        return subscriptions.get(subscriptionId);
    }

    /**
     * Returns all currently active webhook subscriptions.
     */
    public List<WebhookSubscription> getAllSubscriptions() {
        return new ArrayList<>(subscriptions.values());
    }

    /**
     * Dispatches a committed CDC event to all matching registered webhook subscriptions.
     * Non-blocking: tasks are submitted to virtual threads.
     */
    public void dispatch(CdcEvent event) {
        if (!running.get() || subscriptions.isEmpty() || event == null) {
            return;
        }

        for (WebhookSubscription sub : subscriptions.values()) {
            if (sub.matches(event)) {
                try {
                    executor.submit(() -> deliver(sub, event));
                } catch (RejectedExecutionException ree) {
                    if (running.get()) {
                        log.warn("Failed to schedule webhook delivery for sub={}: executor rejected", sub.getId(), ree);
                    }
                }
            }
        }
    }

    private void deliver(WebhookSubscription sub, CdcEvent event) {
        byte[] payloadBytes;
        try {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("eventId", event.eventId());
            body.put("logIndex", event.logIndex());
            body.put("logTerm", event.logTerm());
            body.put("operation", event.operation().name());
            body.put("key", event.key());
            String val = (event.payload() != null && event.payload().length > 0)
                    ? new String(event.payload(), StandardCharsets.UTF_8)
                    : "";
            body.put("payload", val);
            body.put("version", event.version());
            body.put("timestamp", event.timestampEpochMs());
            body.put("subscriptionId", sub.getId());

            payloadBytes = json.writeValueAsBytes(body);
        } catch (Exception e) {
            log.error("Failed to serialize webhook payload for event {}", event.eventId(), e);
            return;
        }

        int attempt = 0;
        boolean delivered = false;
        String lastError = "Unknown error";

        while (attempt < sub.getMaxRetries() && !delivered && running.get()) {
            attempt++;
            try {
                HttpRequest.Builder reqBuilder = HttpRequest.newBuilder()
                        .uri(URI.create(sub.getTargetUrl()))
                        .header("Content-Type", "application/json; charset=utf-8")
                        .header("User-Agent", "Raftline-Webhook/1.0")
                        .header("X-Raftline-Event-Id", String.valueOf(event.eventId()))
                        .timeout(Duration.ofSeconds(3))
                        .POST(HttpRequest.BodyPublishers.ofByteArray(payloadBytes));

                if (sub.getSecret() != null) {
                    String signature = computeHmacSha256(payloadBytes, sub.getSecret());
                    reqBuilder.header("X-Raftline-Signature", "sha256=" + signature);
                }

                HttpResponse<String> response = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
                if (response.statusCode() >= 200 && response.statusCode() < 300) {
                    sub.incrementDeliveredCount();
                    delivered = true;
                    break;
                } else {
                    lastError = "HTTP " + response.statusCode() + ": " + response.body();
                }
            } catch (Exception e) {
                lastError = (e.getMessage() != null) ? e.getMessage() : e.getClass().getSimpleName();
            }

            if (!delivered && attempt < sub.getMaxRetries() && running.get()) {
                long backoffMs = Math.min(retryBaseMs * (1L << (attempt - 1)), 5000L);
                try {
                    Thread.sleep(backoffMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }

        if (!delivered) {
            sub.incrementFailedCount();
            DeadLetterEvent dlqEvent = new DeadLetterEvent(
                    UUID.randomUUID().toString(),
                    sub.getId(),
                    sub.getTargetUrl(),
                    event,
                    lastError,
                    attempt,
                    System.currentTimeMillis()
            );
            deadLetterQueue.addLast(dlqEvent);
            while (deadLetterQueue.size() > maxDlqCapacity) {
                deadLetterQueue.pollFirst();
            }
            log.warn("Webhook delivery failed after {} attempts for sub={} url={} key={}: {}",
                    attempt, sub.getId(), sub.getTargetUrl(), event.key(), lastError);
        }
    }

    /**
     * Computes HMAC-SHA256 signature for message payload authentication.
     */
    public static String computeHmacSha256(byte[] data, String secret) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec keySpec = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            mac.init(keySpec);
            byte[] raw = mac.doFinal(data);
            return HexFormat.of().formatHex(raw);
        } catch (Exception e) {
            throw new RuntimeException("Failed to compute HMAC-SHA256", e);
        }
    }

    /**
     * Retrieves up to `limit` dead-letter events from the queue.
     */
    public List<DeadLetterEvent> getDeadLetterQueue(int limit) {
        int max = (limit > 0) ? Math.min(limit, 1000) : 100;
        List<DeadLetterEvent> list = new ArrayList<>();
        for (DeadLetterEvent dle : deadLetterQueue) {
            list.add(dle);
            if (list.size() >= max) {
                break;
            }
        }
        return list;
    }

    /**
     * Clears all dead-letter records.
     */
    public void clearDeadLetterQueue() {
        deadLetterQueue.clear();
    }

    /**
     * Returns current number of records in the DLQ.
     */
    public int getDeadLetterQueueSize() {
        return deadLetterQueue.size();
    }

    @Override
    public void close() {
        if (running.compareAndSet(true, false)) {
            executor.shutdownNow();
            subscriptions.clear();
        }
    }
}
