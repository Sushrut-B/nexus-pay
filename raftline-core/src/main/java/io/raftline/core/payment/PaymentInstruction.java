package io.raftline.core.payment;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * High-speed electronic payment instruction payload.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PaymentInstruction {
    private String idempotencyKey;
    private PaymentRail rail;
    private String sourceAccountId;
    private String destinationAccountId;
    private long amountCents;
    private String currency;
    private String description;
    private String tenantId;
    private long timestamp;
    private Map<String, String> metadata = new HashMap<>();

    public PaymentInstruction() {
        this.rail = PaymentRail.INTERNAL_BOOK;
        this.timestamp = System.currentTimeMillis();
    }

    public PaymentInstruction(String idempotencyKey, PaymentRail rail, String sourceAccountId,
                              String destinationAccountId, long amountCents, String currency,
                              String description, String tenantId, Map<String, String> metadata) {
        this.idempotencyKey = Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        this.rail = rail != null ? rail : PaymentRail.INTERNAL_BOOK;
        this.sourceAccountId = Objects.requireNonNull(sourceAccountId, "sourceAccountId");
        this.destinationAccountId = Objects.requireNonNull(destinationAccountId, "destinationAccountId");
        this.amountCents = amountCents;
        this.currency = (currency != null && !currency.isBlank()) ? currency.toUpperCase() : "USD";
        this.description = description != null ? description : "";
        this.tenantId = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        this.timestamp = System.currentTimeMillis();
        if (metadata != null) {
            this.metadata.putAll(metadata);
        }
    }

    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }

    public PaymentRail getRail() { return rail; }
    public void setRail(PaymentRail rail) { this.rail = rail; }

    public String getSourceAccountId() { return sourceAccountId; }
    public void setSourceAccountId(String sourceAccountId) { this.sourceAccountId = sourceAccountId; }

    public String getDestinationAccountId() { return destinationAccountId; }
    public void setDestinationAccountId(String destinationAccountId) { this.destinationAccountId = destinationAccountId; }

    public long getAmountCents() { return amountCents; }
    public void setAmountCents(long amountCents) { this.amountCents = amountCents; }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }

    public Map<String, String> getMetadata() { return metadata; }
    public void setMetadata(Map<String, String> metadata) {
        this.metadata = metadata != null ? metadata : new HashMap<>();
    }
}

