package io.raftline.core.webhook;

import io.raftline.core.cdc.CdcEvent;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Configuration, filtering rules, and delivery metrics for a registered external webhook sink.
 */
public class WebhookSubscription {
    private final String id;
    private final String targetUrl;
    private final String prefixFilter;
    private final Set<CdcEvent.OperationType> operations;
    private final String secret;
    private final int maxRetries;
    private final long createdEpochMs;

    private final AtomicLong deliveredCount = new AtomicLong(0);
    private final AtomicLong failedCount = new AtomicLong(0);

    public WebhookSubscription(String id,
                               String targetUrl,
                               String prefixFilter,
                               Set<CdcEvent.OperationType> operations,
                               String secret,
                               int maxRetries) {
        this.id = Objects.requireNonNull(id, "id");
        this.targetUrl = Objects.requireNonNull(targetUrl, "targetUrl");
        this.prefixFilter = (prefixFilter != null) ? prefixFilter : "";
        this.operations = (operations != null && !operations.isEmpty()) ? Set.copyOf(operations) : Collections.emptySet();
        this.secret = (secret != null && !secret.isBlank()) ? secret.trim() : null;
        this.maxRetries = Math.max(1, maxRetries);
        this.createdEpochMs = System.currentTimeMillis();
    }

    public String getId() {
        return id;
    }

    public String getTargetUrl() {
        return targetUrl;
    }

    public String getPrefixFilter() {
        return prefixFilter;
    }

    public Set<CdcEvent.OperationType> getOperations() {
        return operations;
    }

    public String getSecret() {
        return secret;
    }

    public int getMaxRetries() {
        return maxRetries;
    }

    public long getCreatedEpochMs() {
        return createdEpochMs;
    }

    public long getDeliveredCount() {
        return deliveredCount.get();
    }

    public long incrementDeliveredCount() {
        return deliveredCount.incrementAndGet();
    }

    public long getFailedCount() {
        return failedCount.get();
    }

    public long incrementFailedCount() {
        return failedCount.incrementAndGet();
    }

    /**
     * Determines whether a committed CDC event matches this subscription's prefix and operation filters.
     */
    public boolean matches(CdcEvent event) {
        if (event == null) {
            return false;
        }
        if (!prefixFilter.isEmpty() && !event.key().startsWith(prefixFilter)) {
            return false;
        }
        if (!operations.isEmpty() && !operations.contains(event.operation())) {
            return false;
        }
        return true;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("targetUrl", targetUrl);
        m.put("prefixFilter", prefixFilter);
        m.put("operations", operations.stream().map(Enum::name).toList());
        m.put("hasSecret", secret != null);
        m.put("maxRetries", maxRetries);
        m.put("createdEpochMs", createdEpochMs);
        m.put("deliveredCount", deliveredCount.get());
        m.put("failedCount", failedCount.get());
        return m;
    }
}
