package io.raftline.core.payment;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Immutable consensus receipt for a payment instruction.
 * Preserves whether the returned receipt was an idempotent replay of an earlier execution.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class PaymentResult {
    private static final ObjectMapper json = new ObjectMapper();

    private String paymentRef;
    private String idempotencyKey;
    private PaymentStatus status;
    private PaymentRail rail;
    private String sourceAccountId;
    private String destinationAccountId;
    private long amountCents;
    private String currency;
    private long sourceBalanceAfter;
    private long destinationBalanceAfter;
    private String rejectionReason;
    private long settledAt;
    private long raftLogIndex;
    private boolean isIdempotentReplay;

    public PaymentResult() {}

    public static PaymentResult settled(String paymentRef, String idempotencyKey, PaymentRail rail,
                                         String sourceAccountId, String destinationAccountId,
                                         long amountCents, String currency, long sourceBalAfter,
                                         long destBalAfter, long raftLogIndex) {
        PaymentResult res = new PaymentResult();
        res.paymentRef = paymentRef;
        res.idempotencyKey = idempotencyKey;
        res.status = PaymentStatus.SETTLED;
        res.rail = rail;
        res.sourceAccountId = sourceAccountId;
        res.destinationAccountId = destinationAccountId;
        res.amountCents = amountCents;
        res.currency = currency;
        res.sourceBalanceAfter = sourceBalAfter;
        res.destinationBalanceAfter = destBalAfter;
        res.rejectionReason = null;
        res.settledAt = System.currentTimeMillis();
        res.raftLogIndex = raftLogIndex;
        res.isIdempotentReplay = false;
        return res;
    }

    public static PaymentResult authorized(String paymentRef, String idempotencyKey, PaymentRail rail,
                                           String sourceAccountId, String destinationAccountId,
                                           long amountCents, String currency, long sourceBalAfter, long raftLogIndex) {
        PaymentResult res = new PaymentResult();
        res.paymentRef = paymentRef;
        res.idempotencyKey = idempotencyKey;
        res.status = PaymentStatus.AUTHORIZED;
        res.rail = rail;
        res.sourceAccountId = sourceAccountId;
        res.destinationAccountId = destinationAccountId;
        res.amountCents = amountCents;
        res.currency = currency;
        res.sourceBalanceAfter = sourceBalAfter;
        res.destinationBalanceAfter = -1L;
        res.rejectionReason = null;
        res.settledAt = System.currentTimeMillis();
        res.raftLogIndex = raftLogIndex;
        res.isIdempotentReplay = false;
        return res;
    }

    public static PaymentResult rejected(String paymentRef, String idempotencyKey, PaymentRail rail,
                                         String sourceAccountId, String destinationAccountId,
                                         long amountCents, String currency, String reason, long raftLogIndex) {
        PaymentResult res = new PaymentResult();
        res.paymentRef = paymentRef;
        res.idempotencyKey = idempotencyKey;
        res.status = PaymentStatus.REJECTED;
        res.rail = rail;
        res.sourceAccountId = sourceAccountId;
        res.destinationAccountId = destinationAccountId;
        res.amountCents = amountCents;
        res.currency = currency;
        res.sourceBalanceAfter = -1L;
        res.destinationBalanceAfter = -1L;
        res.rejectionReason = reason;
        res.settledAt = System.currentTimeMillis();
        res.raftLogIndex = raftLogIndex;
        res.isIdempotentReplay = false;
        return res;
    }

    public String getPaymentRef() { return paymentRef; }
    public void setPaymentRef(String paymentRef) { this.paymentRef = paymentRef; }

    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }

    public PaymentStatus getStatus() { return status; }
    public void setStatus(PaymentStatus status) { this.status = status; }

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

    public long getSourceBalanceAfter() { return sourceBalanceAfter; }
    public void setSourceBalanceAfter(long sourceBalanceAfter) { this.sourceBalanceAfter = sourceBalanceAfter; }

    public long getDestinationBalanceAfter() { return destinationBalanceAfter; }
    public void setDestinationBalanceAfter(long destinationBalanceAfter) { this.destinationBalanceAfter = destinationBalanceAfter; }

    public String getRejectionReason() { return rejectionReason; }
    public void setRejectionReason(String rejectionReason) { this.rejectionReason = rejectionReason; }

    public long getSettledAt() { return settledAt; }
    public void setSettledAt(long settledAt) { this.settledAt = settledAt; }

    public long getRaftLogIndex() { return raftLogIndex; }
    public void setRaftLogIndex(long raftLogIndex) { this.raftLogIndex = raftLogIndex; }

    public boolean isIdempotentReplay() { return isIdempotentReplay; }
    public void setIdempotentReplay(boolean idempotentReplay) { isIdempotentReplay = idempotentReplay; }

    public Map<String, Object> toMap() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("paymentRef", paymentRef);
        map.put("idempotencyKey", idempotencyKey);
        map.put("status", status != null ? status.name() : "");
        map.put("rail", rail != null ? rail.name() : "");
        map.put("sourceAccountId", sourceAccountId);
        map.put("destinationAccountId", destinationAccountId);
        map.put("amountCents", amountCents);
        map.put("currency", currency);
        map.put("sourceBalanceAfter", sourceBalanceAfter);
        map.put("destinationBalanceAfter", destinationBalanceAfter);
        if (rejectionReason != null) {
            map.put("rejectionReason", rejectionReason);
        }
        map.put("settledAt", settledAt);
        map.put("raftLogIndex", raftLogIndex);
        map.put("isIdempotentReplay", isIdempotentReplay);
        return map;
    }

    public byte[] toJsonBytes() {
        try {
            return json.writeValueAsBytes(this);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize PaymentResult", e);
        }
    }

    public String toIso20022Xml() {
        String isoTime = java.time.Instant.ofEpochMilli(settledAt > 0 ? settledAt : System.currentTimeMillis()).toString();
        double amt = amountCents / 100.0;
        String formattedAmt = String.format(java.util.Locale.US, "%.2f", amt);
        String railCode = (rail != null) ? rail.name() : "FEDNOW";

        return String.format(java.util.Locale.US,
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                "<Document xmlns=\"urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08\">\n" +
                "  <FIToFICstmrCdtTrf>\n" +
                "    <GrpHdr>\n" +
                "      <MsgId>MSG-%s</MsgId>\n" +
                "      <CreDtTm>%s</CreDtTm>\n" +
                "      <NbOfTxs>1</NbOfTxs>\n" +
                "      <SttlmInf>\n" +
                "        <SttlmMtd>CLRG</SttlmMtd>\n" +
                "        <ClrSys>\n" +
                "          <Prtry>%s</Prtry>\n" +
                "        </ClrSys>\n" +
                "      </SttlmInf>\n" +
                "    </GrpHdr>\n" +
                "    <CdtTrfTxInf>\n" +
                "      <PmtId>\n" +
                "        <EndToEndId>%s</EndToEndId>\n" +
                "        <TxId>%s</TxId>\n" +
                "        <ClrSysRef>RAFT-LOG-IDX-%d</ClrSysRef>\n" +
                "      </PmtId>\n" +
                "      <IntrBkSttlmAmt Ccy=\"%s\">%s</IntrBkSttlmAmt>\n" +
                "      <Dbtr>\n" +
                "        <Nm>%s</Nm>\n" +
                "      </Dbtr>\n" +
                "      <Cdtr>\n" +
                "        <Nm>%s</Nm>\n" +
                "      </Cdtr>\n" +
                "      <RmtInf>\n" +
                "        <Ustrd>Raftline Real-Time Settlement [%s]</Ustrd>\n" +
                "      </RmtInf>\n" +
                "    </CdtTrfTxInf>\n" +
                "  </FIToFICstmrCdtTrf>\n" +
                "</Document>",
                paymentRef, isoTime, railCode, idempotencyKey, paymentRef, raftLogIndex,
                currency != null ? currency : "USD", formattedAmt,
                sourceAccountId != null ? sourceAccountId : "UNKNOWN",
                destinationAccountId != null ? destinationAccountId : "UNKNOWN",
                status != null ? status.name() : "SETTLED");
    }

    public static PaymentResult fromJsonBytes(byte[] bytes) throws IOException {
        return json.readValue(bytes, PaymentResult.class);
    }
}

