package io.raftline.core.webhook;

import io.raftline.core.cdc.CdcEvent;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Record representing a CDC event that failed delivery to an external webhook sink after max retries.
 */
public record DeadLetterEvent(
        String deadLetterId,
        String subscriptionId,
        String targetUrl,
        CdcEvent event,
        String failureReason,
        int attempts,
        long failedAtEpochMs
) {
    public DeadLetterEvent {
        Objects.requireNonNull(deadLetterId, "deadLetterId");
        Objects.requireNonNull(subscriptionId, "subscriptionId");
        Objects.requireNonNull(targetUrl, "targetUrl");
        Objects.requireNonNull(event, "event");
        Objects.requireNonNull(failureReason, "failureReason");
    }

    public Map<String, Object> toMap() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("deadLetterId", deadLetterId);
        m.put("subscriptionId", subscriptionId);
        m.put("targetUrl", targetUrl);
        m.put("failureReason", failureReason);
        m.put("attempts", attempts);
        m.put("failedAt", failedAtEpochMs);
        if (event != null) {
            String valStr = (event.payload() != null && event.payload().length > 0)
                    ? new String(event.payload(), StandardCharsets.UTF_8)
                    : "";
            m.put("event", Map.of(
                    "eventId", event.eventId(),
                    "logIndex", event.logIndex(),
                    "logTerm", event.logTerm(),
                    "operation", event.operation().name(),
                    "key", event.key(),
                    "payload", valStr,
                    "version", event.version(),
                    "timestamp", event.timestampEpochMs()
            ));
        }
        return m;
    }
}
