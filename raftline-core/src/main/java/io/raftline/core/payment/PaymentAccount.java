package io.raftline.core.payment;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.*;

/**
 * High-precision financial account entity with balance, authorization hold reservations,
 * and currency isolation.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PaymentAccount {
    private static final ObjectMapper json = new ObjectMapper();

    private String accountId;
    private String tenantId;
    private String currency;
    private long balanceCents;
    private long reservedCents;
    private String status;
    private long createdAt;
    private long updatedAt;
    private Map<String, String> metadata = new HashMap<>();

    public PaymentAccount() {
        // default constructor for Jackson
    }

    public PaymentAccount(String accountId, String tenantId, String currency, long balanceCents, String status, Map<String, String> metadata) {
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.tenantId = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        this.currency = (currency != null && !currency.isBlank()) ? currency.toUpperCase() : "USD";
        this.balanceCents = balanceCents;
        this.reservedCents = 0L;
        this.status = (status != null && !status.isBlank()) ? status.toUpperCase() : "ACTIVE";
        long now = System.currentTimeMillis();
        this.createdAt = now;
        this.updatedAt = now;
        if (metadata != null) {
            this.metadata.putAll(metadata);
        }
    }

    public String getAccountId() {
        return accountId;
    }

    public void setAccountId(String accountId) {
        this.accountId = accountId;
    }

    public String getTenantId() {
        return tenantId;
    }

    public void setTenantId(String tenantId) {
        this.tenantId = tenantId;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public long getBalanceCents() {
        return balanceCents;
    }

    public void setBalanceCents(long balanceCents) {
        this.balanceCents = balanceCents;
    }

    public long getReservedCents() {
        return reservedCents;
    }

    public void setReservedCents(long reservedCents) {
        this.reservedCents = reservedCents;
    }

    public long getAvailableBalanceCents() {
        return balanceCents - reservedCents;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(long createdAt) {
        this.createdAt = createdAt;
    }

    public long getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(long updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Map<String, String> getMetadata() {
        return metadata;
    }

    public void setMetadata(Map<String, String> metadata) {
        this.metadata = metadata != null ? metadata : new HashMap<>();
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("accountId", accountId);
        map.put("tenantId", tenantId);
        map.put("currency", currency);
        map.put("balanceCents", balanceCents);
        map.put("reservedCents", reservedCents);
        map.put("availableBalanceCents", getAvailableBalanceCents());
        map.put("status", status);
        map.put("createdAt", createdAt);
        map.put("updatedAt", updatedAt);
        map.put("metadata", metadata);
        return map;
    }

    public byte[] toJsonBytes() {
        try {
            return json.writeValueAsBytes(this);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize PaymentAccount", e);
        }
    }

    public static PaymentAccount fromJsonBytes(byte[] bytes) throws IOException {
        return json.readValue(bytes, PaymentAccount.class);
    }
}

