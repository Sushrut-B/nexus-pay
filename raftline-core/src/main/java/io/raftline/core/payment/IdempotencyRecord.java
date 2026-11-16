package io.raftline.core.payment;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Replicated, observable record of a single idempotency key lifecycle.
 *
 * <p>One record is written per idempotency key inside the Raft state machine, in the very
 * same atomic mutation that performs (or rejects) the financial operation. Because it lives
 * in the replicated log, the record - including the request fingerprint, the original Raft
 * log index and the replay counters - is identical on every node and survives leader
 * changes.
 *
 * <p>The record is the audit surface behind the Nexus Clearing idempotency observatory: it
 * answers "what was originally executed under this key, was it replayed, and did anybody try
 * to reuse the key with a different payload?".
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class IdempotencyRecord {
    private static final ObjectMapper json = new ObjectMapper();

    /** Operation kinds recorded against an idempotency key. */
    public static final String OP_SETTLE = "SETTLE";
    public static final String OP_AUTHORIZE = "AUTHORIZE";
    public static final String OP_CAPTURE = "CAPTURE";
    public static final String OP_FUND = "FUND";

    /** Terminal execution outcomes recorded against an idempotency key. */
    public static final String OUTCOME_EXECUTED = "EXECUTED";
    public static final String OUTCOME_REJECTED = "REJECTED";
    public static final String OUTCOME_REPLAYED = "REPLAYED";
    public static final String OUTCOME_CONFLICT = "CONFLICT_REJECTED";

    private String idempotencyKey;
    private String tenantId = "default";
    private String operation = OP_SETTLE;
    private String requestFingerprint;
    private String paymentRef;
    private String status;
    private String rail;
    private String sourceAccountId;
    private String destinationAccountId;
    private long amountCents;
    private String currency;
    private long originalRaftLogIndex;
    private long firstExecutedAt;
    private long lastObservedAt;
    private long replayCount;
    private long conflictCount;
    private String lastOutcome;
    private String rejectionReason;

    public IdempotencyRecord() {}

    public IdempotencyRecord(String idempotencyKey, String tenantId, String operation,
                             String requestFingerprint) {
        this.idempotencyKey = idempotencyKey;
        this.tenantId = tenantId;
        this.operation = operation;
        this.requestFingerprint = requestFingerprint;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("idempotencyKey", idempotencyKey);
        map.put("tenantId", tenantId);
        map.put("operation", operation);
        map.put("requestFingerprint", requestFingerprint);
        map.put("paymentRef", paymentRef);
        map.put("status", status);
        map.put("rail", rail);
        map.put("sourceAccountId", sourceAccountId);
        map.put("destinationAccountId", destinationAccountId);
        map.put("amountCents", amountCents);
        map.put("currency", currency);
        map.put("originalRaftLogIndex", originalRaftLogIndex);
        map.put("firstExecutedAt", firstExecutedAt);
        map.put("lastObservedAt", lastObservedAt);
        map.put("replayCount", replayCount);
        map.put("conflictCount", conflictCount);
        map.put("lastOutcome", lastOutcome);
        if (rejectionReason != null) {
            map.put("rejectionReason", rejectionReason);
        }
        return map;
    }

    public byte[] toJsonBytes() {
        try {
            return json.writeValueAsBytes(this);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize IdempotencyRecord", e);
        }
    }

    public static IdempotencyRecord fromJsonBytes(byte[] bytes) throws IOException {
        return json.readValue(bytes, IdempotencyRecord.class);
    }

    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String tenantId) { this.tenantId = tenantId; }

    public String getOperation() { return operation; }
    public void setOperation(String operation) { this.operation = operation; }

    public String getRequestFingerprint() { return requestFingerprint; }
    public void setRequestFingerprint(String requestFingerprint) { this.requestFingerprint = requestFingerprint; }

    public String getPaymentRef() { return paymentRef; }
    public void setPaymentRef(String paymentRef) { this.paymentRef = paymentRef; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getRail() { return rail; }
    public void setRail(String rail) { this.rail = rail; }

    public String getSourceAccountId() { return sourceAccountId; }
    public void setSourceAccountId(String sourceAccountId) { this.sourceAccountId = sourceAccountId; }

    public String getDestinationAccountId() { return destinationAccountId; }
    public void setDestinationAccountId(String destinationAccountId) { this.destinationAccountId = destinationAccountId; }

    public long getAmountCents() { return amountCents; }
    public void setAmountCents(long amountCents) { this.amountCents = amountCents; }

    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }

    public long getOriginalRaftLogIndex() { return originalRaftLogIndex; }
    public void setOriginalRaftLogIndex(long originalRaftLogIndex) { this.originalRaftLogIndex = originalRaftLogIndex; }

    public long getFirstExecutedAt() { return firstExecutedAt; }
    public void setFirstExecutedAt(long firstExecutedAt) { this.firstExecutedAt = firstExecutedAt; }

    public long getLastObservedAt() { return lastObservedAt; }
    public void setLastObservedAt(long lastObservedAt) { this.lastObservedAt = lastObservedAt; }

    public long getReplayCount() { return replayCount; }
    public void setReplayCount(long replayCount) { this.replayCount = replayCount; }

    public long getConflictCount() { return conflictCount; }
    public void setConflictCount(long conflictCount) { this.conflictCount = conflictCount; }

    public String getLastOutcome() { return lastOutcome; }
    public void setLastOutcome(String lastOutcome) { this.lastOutcome = lastOutcome; }

    public String getRejectionReason() { return rejectionReason; }
    public void setRejectionReason(String rejectionReason) { this.rejectionReason = rejectionReason; }
}
