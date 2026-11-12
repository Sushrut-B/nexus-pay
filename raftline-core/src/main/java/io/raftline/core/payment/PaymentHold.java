package io.raftline.core.payment;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Two-phase authorization hold reservation on debtor account funds.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PaymentHold {
    private static final ObjectMapper json = new ObjectMapper();

    private String holdId;
    private String tenantId;
    private String sourceAccountId;
    private String destinationAccountId;
    private long amountCents;
    private String currency;
    private String idempotencyKey;
    private PaymentStatus status;
    private long createdAt;
    private long expiresAt;

    public PaymentHold() {}

    public PaymentHold(String holdId, String tenantId, String sourceAccountId, String destinationAccountId,
                       long amountCents, String currency, String idempotencyKey, long ttlMillis) {
        this.holdId = Objects.requireNonNull(holdId, "holdId");
        this.tenantId = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        this.sourceAccountId = Objects.requireNonNull(sourceAccountId, "sourceAccountId");
        this.destinationAccountId = Objects.requireNonNull(destinationAccountId, "destinationAccountId");
        this.amountCents = amountCents;
        this.currency = (currency != null && !currency.isBlank()) ? currency.toUpperCase() : "USD";
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        this.status = PaymentStatus.AUTHORIZED;
        long now = System.currentTimeMillis();
        this.createdAt = now;
        this.expiresAt = now + (ttlMillis > 0 ? ttlMillis : 86_400_000L); // default 24hr
    }

    public String getHoldId() { return holdId; }
    public void setHoldId(String holdId) { this.holdId = holdId; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public String getSourceAccountId() { return sourceAccountId; }
    public void setSourceAccountId(String sourceAccountId) { this.sourceAccountId = sourceAccountId; }

    public String getDestinationAccountId() { return destinationAccountId; }
    public void setDestinationAccountId(String destinationAccountId) { this.destinationAccountId = destinationAccountId; }

    public long getAmountCents() { return amountCents; }
    public void setAmountCents(long amountCents) { this.amountCents = amountCents; }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }

    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }

    public PaymentStatus getStatus() { return status; }
    public void setStatus(PaymentStatus status) { this.status = status; }

    public long getCreatedAt() { return createdAt; }
    public void setCreatedAt(long createdAt) { this.createdAt = createdAt; }

    public long getExpiresAt() { return expiresAt; }
    public void setExpiresAt(long expiresAt) { this.expiresAt = expiresAt; }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("holdId", holdId);
        map.put("tenantId", tenantId);
        map.put("sourceAccountId", sourceAccountId);
        map.put("destinationAccountId", destinationAccountId);
        map.put("amountCents", amountCents);
        map.put("currency", currency);
        map.put("idempotencyKey", idempotencyKey);
        map.put("status", status != null ? status.name() : "");
        map.put("createdAt", createdAt);
        map.put("expiresAt", expiresAt);
        return map;
    }

    public byte[] toJsonBytes() {
        try {
            return json.writeValueAsBytes(this);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize PaymentHold", e);
        }
    }

    public static PaymentHold fromJsonBytes(byte[] bytes) throws IOException {
        return json.readValue(bytes, PaymentHold.class);
    }
}

