package io.raftline.core.payment;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * Deterministic request fingerprinting for idempotency keys.
 *
 * <p>A fingerprint captures the <em>entire</em> financially meaningful content of a request.
 * Two requests sharing an idempotency key are considered the same request if and only if
 * their fingerprints match. Reusing a key with a different payload therefore produces a
 * different fingerprint and is rejected rather than silently replaying the original receipt.
 *
 * <p>The canonical form is a delimiter-separated string of the operation and its material
 * fields, hashed with SHA-256. It is computed identically on every replica, so the
 * duplicate-vs-conflict decision is deterministic across the cluster.
 */
public final class PaymentFingerprint {

    private static final char SEP = '\u001f';

    private PaymentFingerprint() {}

    /**
     * Canonical fingerprint for a settlement instruction.
     */
    public static String forSettlement(PaymentInstruction instruction, String tenantId) {
        return sha256(canonical(
                IdempotencyRecord.OP_SETTLE,
                nullSafe(instruction.getRail() == null ? null : instruction.getRail().name()),
                nullSafe(instruction.getSourceAccountId()),
                nullSafe(instruction.getDestinationAccountId()),
                Long.toString(instruction.getAmountCents()),
                nullSafe(instruction.getCurrency())));
    }

    /**
     * Canonical fingerprint derived from an existing settlement receipt. Used to validate
     * receipts that were written before fingerprinting was introduced, so that a replay of
     * a historical request is still recognised as a duplicate instead of double-debiting.
     */
    public static String forSettlementResult(PaymentResult result) {
        return sha256(canonical(
                IdempotencyRecord.OP_SETTLE,
                nullSafe(result.getRail() == null ? null : result.getRail().name()),
                nullSafe(result.getSourceAccountId()),
                nullSafe(result.getDestinationAccountId()),
                Long.toString(result.getAmountCents()),
                nullSafe(result.getCurrency())));
    }

    /**
     * Canonical fingerprint for an authorization (two-phase reserve) instruction.
     */
    public static String forAuthorization(PaymentInstruction instruction, String tenantId) {
        return sha256(canonical(
                IdempotencyRecord.OP_AUTHORIZE,
                nullSafe(instruction.getSourceAccountId()),
                nullSafe(instruction.getDestinationAccountId()),
                Long.toString(instruction.getAmountCents()),
                nullSafe(instruction.getCurrency())));
    }

    /**
     * Canonical fingerprint for a capture of an existing hold.
     */
    public static String forCapture(String holdId, long amountCents, String currency, String tenantId) {
        return sha256(canonical(
                IdempotencyRecord.OP_CAPTURE,
                nullSafe(holdId),
                Long.toString(amountCents),
                nullSafe(currency)));
    }

    /**
     * Canonical fingerprint for an account funding operation.
     */
    public static String forFunding(String accountId, long amountCents, String currency, String tenantId) {
        return sha256(canonical(
                IdempotencyRecord.OP_FUND,
                nullSafe(accountId),
                Long.toString(amountCents),
                nullSafe(currency)));
    }

    private static String canonical(String... parts) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) {
                sb.append(SEP);
            }
            sb.append(parts[i] == null ? "" : parts[i]);
        }
        return sb.toString();
    }

    private static String nullSafe(String value) {
        return value == null ? "" : value.toUpperCase(Locale.ROOT);
    }

    /**
     * Lowercase hex SHA-256 of the UTF-8 encoding of {@code input}.
     */
    public static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
