package io.raftline.core.payment;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.NotLeaderException;
import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.model.MultiPutPayload;
import io.raftline.storage.state.ApplyResult;
import io.raftline.storage.state.VersionedValue;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Real-Time Payment Settlement &amp; Idempotency Switch.
 *
 * <p>Designed for instant payment rails (FedNow, SEPA Instant, UPI, Faster Payments).
 * Guarantees strictly-once (idempotent) execution semantics, preventing duplicate debits
 * under network retries, while enforcing double-entry balance invariants and linearizable
 * ReadIndex balance lookups.
 *
 * <h2>Idempotency model</h2>
 * Every financially meaningful operation is keyed by a client supplied idempotency key and
 * carries a deterministic {@link PaymentFingerprint} of its payload. The engine persists
 * both the fingerprint and a full {@link IdempotencyRecord} inside the replicated state
 * machine, in the very same atomic mutation that performs the money movement.
 *
 * <p>The check-then-act sequence is guarded at the state machine level
 * ({@link io.raftline.storage.model.CommandType#MULTI_PUT}) rather than in application
 * code. That guarantees:
 * <ul>
 *   <li>an identical duplicate request never produces a second debit, even when two copies
 *       arrive concurrently, because the state machine rejects the second guarded mutation;</li>
 *   <li>a key reused with a different payload is rejected with
 *       {@code IDEMPOTENCY_KEY_PAYLOAD_CONFLICT} instead of silently replaying the
 *       original receipt;</li>
 *   <li>the decision is deterministic on every replica, because it is evaluated inside the
 *       replicated log rather than in node-local state.</li>
 * </ul>
 */
public class PaymentSettlementEngine implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(PaymentSettlementEngine.class);
    private static final ObjectMapper json = new ObjectMapper();

    /** Rejection reason returned when an idempotency key is reused with a different payload. */
    public static final String REASON_IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT";

    private final RaftNode raftNode;

    // Metrics counters
    private final AtomicLong totalSettledCount = new AtomicLong(0);
    private final AtomicLong totalSettledVolumeCents = new AtomicLong(0);
    private final AtomicLong totalRejectedCount = new AtomicLong(0);
    private final AtomicLong totalIdempotentReplays = new AtomicLong(0);
    private final AtomicLong totalIdempotencyConflicts = new AtomicLong(0);

    public PaymentSettlementEngine(RaftNode raftNode) {
        this.raftNode = Objects.requireNonNull(raftNode, "raftNode");
    }

    /**
     * Provisions or registers a new payment account.
     */
    public CompletableFuture<PaymentAccount> createAccount(String accountId, String tenantId, String currency,
                                                           long initialBalanceCents, Map<String, String> metadata) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        PaymentAccount account = new PaymentAccount(accountId, effectiveTenant, currency, initialBalanceCents, "ACTIVE", metadata);
        String key = accountKey(effectiveTenant, accountId);

        Command cmd = Command.put(key, account.toJsonBytes(), "sys:payment", System.nanoTime());
        return raftNode.execute(cmd).thenApply(res -> {
            log.info("Created payment account {} [{} {}] on tenant {}", accountId, currency, initialBalanceCents, effectiveTenant);
            return account;
        });
    }

    /**
     * Deposits or top-ups an account with idempotent replay protection.
     */
    public CompletableFuture<PaymentAccount> fundAccount(String accountId, String tenantId, long amountCents, String idempotencyKey) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String idempKey = (idempotencyKey != null && !idempotencyKey.isBlank())
                ? idempotencyKey
                : "fund_" + UUID.randomUUID().toString();

        return CompletableFuture.supplyAsync(() -> {
            try {
                PaymentAccount existing = loadAccount(accountId, effectiveTenant);
                if (existing == null) {
                    throw new NoSuchElementException("Account not found: " + accountId);
                }

                String fingerprint = PaymentFingerprint.forFunding(accountId, amountCents, existing.getCurrency(), effectiveTenant);

                // 1. Idempotency check against the replicated record
                IdempotencyRecord record = readIdempotencyRecord(effectiveTenant, idempKey);
                if (record != null) {
                    if (!fingerprint.equals(record.getRequestFingerprint())) {
                        bumpConflictCount(effectiveTenant, idempKey, record);
                        throw new IllegalStateException(REASON_IDEMPOTENCY_CONFLICT
                                + ": idempotency key '" + idempKey + "' was already used for a "
                                + record.getOperation() + " operation with a different payload");
                    }
                    // Identical duplicate: the credit already happened, never credit twice.
                    PaymentAccount acc = loadAccount(accountId, effectiveTenant);
                    if (acc != null) {
                        bumpReplayCount(effectiveTenant, idempKey, record);
                        return acc;
                    }
                }

                PaymentAccount acc = loadAccount(accountId, effectiveTenant);
                if (acc == null) {
                    throw new NoSuchElementException("Account not found: " + accountId);
                }

                acc.setBalanceCents(acc.getBalanceCents() + amountCents);
                acc.setUpdatedAt(System.currentTimeMillis());

                String pmtRef = "pmt_fund_" + UUID.randomUUID().toString().substring(0, 8);
                PaymentResult res = PaymentResult.settled(pmtRef, idempKey, PaymentRail.INTERNAL_BOOK,
                        "SYSTEM_RESERVE", accountId, amountCents, acc.getCurrency(), 0, acc.getBalanceCents(), 0L);

                IdempotencyRecord idem = new IdempotencyRecord(idempKey, effectiveTenant,
                        IdempotencyRecord.OP_FUND, fingerprint);
                idem.setPaymentRef(pmtRef);
                idem.setStatus(PaymentStatus.SETTLED.name());
                idem.setRail(PaymentRail.INTERNAL_BOOK.name());
                idem.setSourceAccountId("SYSTEM_RESERVE");
                idem.setDestinationAccountId(accountId);
                idem.setAmountCents(amountCents);
                idem.setCurrency(acc.getCurrency());
                idem.setFirstExecutedAt(System.currentTimeMillis());
                idem.setLastObservedAt(System.currentTimeMillis());
                idem.setLastOutcome(IdempotencyRecord.OUTCOME_EXECUTED);

                List<MultiPutPayload.Entry> entries = List.of(
                        new MultiPutPayload.Entry(accountKey(effectiveTenant, accountId), acc.toJsonBytes()),
                        new MultiPutPayload.Entry(txKey(effectiveTenant, idempKey), res.toJsonBytes()),
                        new MultiPutPayload.Entry(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8)),
                        new MultiPutPayload.Entry(idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)),
                        new MultiPutPayload.Entry(idemKey(effectiveTenant, idempKey), idem.toJsonBytes())
                );

                RaftNode.BatchExecution execution = raftNode.executeBatchIndexed(startIndex -> {
                    res.setRaftLogIndex(startIndex);
                    idem.setOriginalRaftLogIndex(startIndex);
                    return List.of(Command.multiPut(entries, idemFingerprintKey(effectiveTenant, idempKey),
                            fingerprint.getBytes(StandardCharsets.UTF_8)));
                }).get(15, TimeUnit.SECONDS);

                ApplyResult apply = execution.results().isEmpty() ? null : execution.results().get(0);
                if (apply != null && !apply.isSuccess()) {
                    if (MultiPutPayload.REJECT_DUPLICATE.equals(apply.getError())) {
                        PaymentAccount current = loadAccount(accountId, effectiveTenant);
                        if (current != null) {
                            totalIdempotentReplays.incrementAndGet();
                            bumpReplayCount(effectiveTenant, idempKey, readIdempotencyRecord(effectiveTenant, idempKey));
                            return current;
                        }
                    } else if (MultiPutPayload.REJECT_CONFLICT.equals(apply.getError())) {
                        totalIdempotencyConflicts.incrementAndGet();
                    }
                    throw new IllegalStateException("Account funding rejected by state machine: " + apply.getError());
                }

                log.info("Funded account {} with {} cents on tenant {}", accountId, amountCents, effectiveTenant);
                return acc;
            } catch (Exception e) {
                if (e instanceof RuntimeException re) throw re;
                throw new CompletionException(e);
            }
        });
    }

    /**
     * Executes real-time settlement for an instant payment instruction with strict idempotency.
     */
    public CompletableFuture<PaymentResult> settlePayment(PaymentInstruction instruction) {
        Objects.requireNonNull(instruction, "instruction");
        String effectiveTenant = (instruction.getTenantId() != null && !instruction.getTenantId().isBlank())
                ? instruction.getTenantId()
                : "default";
        instruction.setTenantId(effectiveTenant);

        return CompletableFuture.supplyAsync(() -> {
            try {
                String idempKey = instruction.getIdempotencyKey();
                if (idempKey == null || idempKey.isBlank()) {
                    throw new IllegalArgumentException("idempotencyKey is required for payment settlement");
                }

                String fingerprint = PaymentFingerprint.forSettlement(instruction, effectiveTenant);

                // 1. Idempotency table check + fingerprint validation
                IdempotencyRecord record = readIdempotencyRecord(effectiveTenant, idempKey);
                if (record != null) {
                    if (!fingerprint.equals(record.getRequestFingerprint())) {
                        // Same key, different payload -> reject, never replay the original receipt.
                        return conflictOutcome(idempKey, fingerprint, record, effectiveTenant);
                    }
                    PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                    if (cached != null) {
                        cached.setIdempotentReplay(true);
                        totalIdempotentReplays.incrementAndGet();
                        bumpReplayCount(effectiveTenant, idempKey, record);
                        log.info("Idempotent replay detected for payment key {}. Returning existing receipt without duplicate debit.", idempKey);
                        return cached;
                    }
                } else {
                    // Legacy receipt written before fingerprinting existed: validate the stored
                    // receipt against the request so a historical duplicate is still a replay.
                    PaymentResult legacy = readCachedReceipt(effectiveTenant, idempKey);
                    if (legacy != null) {
                        if (PaymentFingerprint.forSettlementResult(legacy).equals(fingerprint)) {
                            legacy.setIdempotentReplay(true);
                            totalIdempotentReplays.incrementAndGet();
                            log.info("Idempotent replay detected for legacy payment key {}.", idempKey);
                            return legacy;
                        }
                        IdempotencyRecord synthetic = new IdempotencyRecord(idempKey, effectiveTenant,
                                IdempotencyRecord.OP_SETTLE, PaymentFingerprint.forSettlementResult(legacy));
                        synthetic.setPaymentRef(legacy.getPaymentRef());
                        synthetic.setStatus(legacy.getStatus() != null ? legacy.getStatus().name() : null);
                        synthetic.setSourceAccountId(legacy.getSourceAccountId());
                        synthetic.setDestinationAccountId(legacy.getDestinationAccountId());
                        synthetic.setAmountCents(legacy.getAmountCents());
                        synthetic.setCurrency(legacy.getCurrency());
                        synthetic.setOriginalRaftLogIndex(legacy.getRaftLogIndex());
                        synthetic.setFirstExecutedAt(legacy.getSettledAt());
                        synthetic.setLastObservedAt(System.currentTimeMillis());
                        return conflictOutcome(idempKey, fingerprint, synthetic, effectiveTenant);
                    }
                }

                String pmtRef = "pmt_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

                // 2. Load Debtor and Creditor accounts
                PaymentAccount source = loadAccount(instruction.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(instruction.getDestinationAccountId(), effectiveTenant);

                // Validations
                if (source == null) {
                    return commitRejection(pmtRef, instruction, fingerprint, "SOURCE_ACCOUNT_NOT_FOUND", effectiveTenant);
                }
                if (dest == null) {
                    return commitRejection(pmtRef, instruction, fingerprint, "DESTINATION_ACCOUNT_NOT_FOUND", effectiveTenant);
                }
                if (!"ACTIVE".equalsIgnoreCase(source.getStatus())) {
                    return commitRejection(pmtRef, instruction, fingerprint, "SOURCE_ACCOUNT_" + source.getStatus(), effectiveTenant);
                }
                if (!"ACTIVE".equalsIgnoreCase(dest.getStatus())) {
                    return commitRejection(pmtRef, instruction, fingerprint, "DESTINATION_ACCOUNT_" + dest.getStatus(), effectiveTenant);
                }
                if (instruction.getAmountCents() <= 0) {
                    return commitRejection(pmtRef, instruction, fingerprint, "INVALID_AMOUNT_MUST_BE_POSITIVE", effectiveTenant);
                }
                if (!source.getCurrency().equalsIgnoreCase(instruction.getCurrency()) ||
                    !dest.getCurrency().equalsIgnoreCase(instruction.getCurrency())) {
                    return commitRejection(pmtRef, instruction, fingerprint, "CURRENCY_MISMATCH", effectiveTenant);
                }

                // 3. Balance Invariant Check (Prevent overdrafts)
                if (source.getAvailableBalanceCents() < instruction.getAmountCents()) {
                    return commitRejection(pmtRef, instruction, fingerprint, "INSUFFICIENT_FUNDS", effectiveTenant);
                }

                // 4. Atomic Double-Entry Balance Adjustment
                long now = System.currentTimeMillis();
                source.setBalanceCents(source.getBalanceCents() - instruction.getAmountCents());
                source.setUpdatedAt(now);

                dest.setBalanceCents(dest.getBalanceCents() + instruction.getAmountCents());
                dest.setUpdatedAt(now);

                PaymentResult result = PaymentResult.settled(
                        pmtRef,
                        idempKey,
                        instruction.getRail(),
                        source.getAccountId(),
                        dest.getAccountId(),
                        instruction.getAmountCents(),
                        instruction.getCurrency(),
                        source.getBalanceCents(),
                        dest.getBalanceCents(),
                        0L
                );

                IdempotencyRecord idem = new IdempotencyRecord(idempKey, effectiveTenant,
                        IdempotencyRecord.OP_SETTLE, fingerprint);
                idem.setPaymentRef(pmtRef);
                idem.setStatus(PaymentStatus.SETTLED.name());
                idem.setRail(instruction.getRail().name());
                idem.setSourceAccountId(source.getAccountId());
                idem.setDestinationAccountId(dest.getAccountId());
                idem.setAmountCents(instruction.getAmountCents());
                idem.setCurrency(instruction.getCurrency());
                idem.setFirstExecutedAt(now);
                idem.setLastObservedAt(now);
                idem.setLastOutcome(IdempotencyRecord.OUTCOME_EXECUTED);

                // 5. Execute the atomic consensus batch via Raft. The guarded MULTI_PUT makes
                //    the idempotency check and the double-entry mutation indivisible.
                RaftNode.BatchExecution execution = raftNode.executeBatchIndexed(startIndex -> {
                    result.setRaftLogIndex(startIndex);
                    idem.setOriginalRaftLogIndex(startIndex);
                    return List.of(Command.multiPut(List.of(
                            new MultiPutPayload.Entry(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                            new MultiPutPayload.Entry(accountKey(effectiveTenant, dest.getAccountId()), dest.toJsonBytes()),
                            new MultiPutPayload.Entry(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                            new MultiPutPayload.Entry(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemKey(effectiveTenant, idempKey), idem.toJsonBytes())
                    ), idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)));
                }).get(15, TimeUnit.SECONDS);

                ApplyResult apply = execution.results().isEmpty() ? null : execution.results().get(0);
                if (apply != null && !apply.isSuccess()) {
                    if (MultiPutPayload.REJECT_DUPLICATE.equals(apply.getError())) {
                        // A concurrent twin with the same key won the race. Its receipt is authoritative.
                        PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                        if (cached != null) {
                            cached.setIdempotentReplay(true);
                            totalIdempotentReplays.incrementAndGet();
                            bumpReplayCount(effectiveTenant, idempKey, readIdempotencyRecord(effectiveTenant, idempKey));
                            return cached;
                        }
                    } else if (MultiPutPayload.REJECT_CONFLICT.equals(apply.getError())) {
                        return conflictOutcome(idempKey, fingerprint, readIdempotencyRecord(effectiveTenant, idempKey), effectiveTenant);
                    }
                    throw new IllegalStateException("Settlement batch rejected by state machine: " + apply.getError());
                }

                totalSettledCount.incrementAndGet();
                totalSettledVolumeCents.addAndGet(instruction.getAmountCents());
                log.info("Settled payment {} [{} {}] on rail {} (Debtor: {}, Creditor: {}) at raft index {}",
                        pmtRef, instruction.getCurrency(), instruction.getAmountCents(),
                        instruction.getRail(), source.getAccountId(), dest.getAccountId(), execution.startIndex());

                return result;
            } catch (Exception e) {
                if (e instanceof RuntimeException re) throw re;
                throw new CompletionException(e);
            }
        });
    }

    /**
     * Authorizes a payment hold (Stage 1 of Two-Phase Settlement).
     */
    public CompletableFuture<PaymentResult> authorizeHold(PaymentInstruction instruction, String holdId, long ttlMillis) {
        String effectiveTenant = (instruction.getTenantId() != null && !instruction.getTenantId().isBlank())
                ? instruction.getTenantId() : "default";
        String effectiveHoldId = (holdId != null && !holdId.isBlank()) ? holdId : "hld_" + UUID.randomUUID().toString().substring(0, 12);

        return CompletableFuture.supplyAsync(() -> {
            try {
                String idempKey = instruction.getIdempotencyKey();
                if (idempKey == null || idempKey.isBlank()) {
                    throw new IllegalArgumentException("idempotencyKey is required for payment authorization");
                }
                String fingerprint = PaymentFingerprint.forAuthorization(instruction, effectiveTenant);

                IdempotencyRecord record = readIdempotencyRecord(effectiveTenant, idempKey);
                if (record != null) {
                    if (!fingerprint.equals(record.getRequestFingerprint())) {
                        return conflictOutcome(idempKey, fingerprint, record, effectiveTenant);
                    }
                    PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                    if (cached != null) {
                        cached.setIdempotentReplay(true);
                        totalIdempotentReplays.incrementAndGet();
                        bumpReplayCount(effectiveTenant, idempKey, record);
                        return cached;
                    }
                }

                PaymentAccount source = loadAccount(instruction.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(instruction.getDestinationAccountId(), effectiveTenant);

                String pmtRef = "auth_" + UUID.randomUUID().toString().replace("-", "").substring(0, 14);

                if (source == null || dest == null) {
                    return commitRejection(pmtRef, instruction, fingerprint, "ACCOUNT_NOT_FOUND", effectiveTenant);
                }
                if (source.getAvailableBalanceCents() < instruction.getAmountCents()) {
                    return commitRejection(pmtRef, instruction, fingerprint, "INSUFFICIENT_FUNDS_FOR_HOLD", effectiveTenant);
                }

                // Place reservation hold
                source.setReservedCents(source.getReservedCents() + instruction.getAmountCents());
                source.setUpdatedAt(System.currentTimeMillis());

                PaymentHold hold = new PaymentHold(effectiveHoldId, effectiveTenant, source.getAccountId(),
                        dest.getAccountId(), instruction.getAmountCents(), instruction.getCurrency(), idempKey, ttlMillis);

                PaymentResult result = PaymentResult.authorized(
                        pmtRef,
                        idempKey,
                        instruction.getRail(),
                        source.getAccountId(),
                        dest.getAccountId(),
                        instruction.getAmountCents(),
                        instruction.getCurrency(),
                        source.getBalanceCents(),
                        0L
                );

                IdempotencyRecord idem = new IdempotencyRecord(idempKey, effectiveTenant,
                        IdempotencyRecord.OP_AUTHORIZE, fingerprint);
                idem.setPaymentRef(pmtRef);
                idem.setStatus(PaymentStatus.AUTHORIZED.name());
                idem.setRail(instruction.getRail().name());
                idem.setSourceAccountId(source.getAccountId());
                idem.setDestinationAccountId(dest.getAccountId());
                idem.setAmountCents(instruction.getAmountCents());
                idem.setCurrency(instruction.getCurrency());
                idem.setFirstExecutedAt(System.currentTimeMillis());
                idem.setLastObservedAt(System.currentTimeMillis());
                idem.setLastOutcome(IdempotencyRecord.OUTCOME_EXECUTED);

                RaftNode.BatchExecution execution = raftNode.executeBatchIndexed(startIndex -> {
                    result.setRaftLogIndex(startIndex);
                    idem.setOriginalRaftLogIndex(startIndex);
                    return List.of(Command.multiPut(List.of(
                            new MultiPutPayload.Entry(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                            new MultiPutPayload.Entry(holdKey(effectiveTenant, effectiveHoldId), hold.toJsonBytes()),
                            new MultiPutPayload.Entry(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                            new MultiPutPayload.Entry(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemKey(effectiveTenant, idempKey), idem.toJsonBytes())
                    ), idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)));
                }).get(15, TimeUnit.SECONDS);

                ApplyResult apply = execution.results().isEmpty() ? null : execution.results().get(0);
                if (apply != null && !apply.isSuccess()) {
                    if (MultiPutPayload.REJECT_DUPLICATE.equals(apply.getError())) {
                        PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                        if (cached != null) {
                            cached.setIdempotentReplay(true);
                            totalIdempotentReplays.incrementAndGet();
                            bumpReplayCount(effectiveTenant, idempKey, readIdempotencyRecord(effectiveTenant, idempKey));
                            return cached;
                        }
                    } else if (MultiPutPayload.REJECT_CONFLICT.equals(apply.getError())) {
                        return conflictOutcome(idempKey, fingerprint, readIdempotencyRecord(effectiveTenant, idempKey), effectiveTenant);
                    }
                    throw new IllegalStateException("Authorization batch rejected by state machine: " + apply.getError());
                }

                log.info("Authorized hold {} for {} cents on account {} at raft index {}",
                        effectiveHoldId, instruction.getAmountCents(), source.getAccountId(), execution.startIndex());
                return result;
            } catch (Exception e) {
                if (e instanceof RuntimeException re) throw re;
                throw new CompletionException(e);
            }
        });
    }

    /**
     * Captures an existing authorization hold into final settled funds (Stage 2 of Two-Phase Settlement).
     */
    public CompletableFuture<PaymentResult> captureHold(String holdId, String tenantId, String idempotencyKey) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";

        return CompletableFuture.supplyAsync(() -> {
            try {
                byte[] holdBytes = readState(holdKey(effectiveTenant, holdId));
                if (holdBytes == null || holdBytes.length == 0) {
                    throw new NoSuchElementException("Hold not found: " + holdId);
                }
                PaymentHold hold = PaymentHold.fromJsonBytes(holdBytes);
                if (hold.getStatus() != PaymentStatus.AUTHORIZED) {
                    throw new IllegalStateException("Hold " + holdId + " is already in state: " + hold.getStatus());
                }

                String pmtRef = "pmt_cap_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
                String idempKey = (idempotencyKey != null && !idempotencyKey.isBlank()) ? idempotencyKey : "cap_" + holdId;
                String fingerprint = PaymentFingerprint.forCapture(holdId, hold.getAmountCents(), hold.getCurrency(), effectiveTenant);

                IdempotencyRecord record = readIdempotencyRecord(effectiveTenant, idempKey);
                if (record != null) {
                    if (!fingerprint.equals(record.getRequestFingerprint())) {
                        return conflictOutcome(idempKey, fingerprint, record, effectiveTenant);
                    }
                    PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                    if (cached != null) {
                        cached.setIdempotentReplay(true);
                        totalIdempotentReplays.incrementAndGet();
                        bumpReplayCount(effectiveTenant, idempKey, record);
                        return cached;
                    }
                }

                PaymentAccount source = loadAccount(hold.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(hold.getDestinationAccountId(), effectiveTenant);
                if (source == null || dest == null) {
                    throw new IllegalStateException("Accounts for hold " + holdId + " are no longer available");
                }

                // Settle from reserved funds
                source.setBalanceCents(source.getBalanceCents() - hold.getAmountCents());
                source.setReservedCents(source.getReservedCents() - hold.getAmountCents());
                source.setUpdatedAt(System.currentTimeMillis());

                dest.setBalanceCents(dest.getBalanceCents() + hold.getAmountCents());
                dest.setUpdatedAt(System.currentTimeMillis());

                hold.setStatus(PaymentStatus.CAPTURED);

                PaymentResult result = PaymentResult.settled(
                        pmtRef,
                        idempKey,
                        PaymentRail.INTERNAL_BOOK,
                        source.getAccountId(),
                        dest.getAccountId(),
                        hold.getAmountCents(),
                        hold.getCurrency(),
                        source.getBalanceCents(),
                        dest.getBalanceCents(),
                        0L
                );

                IdempotencyRecord idem = new IdempotencyRecord(idempKey, effectiveTenant,
                        IdempotencyRecord.OP_CAPTURE, fingerprint);
                idem.setPaymentRef(pmtRef);
                idem.setStatus(PaymentStatus.SETTLED.name());
                idem.setRail(PaymentRail.INTERNAL_BOOK.name());
                idem.setSourceAccountId(source.getAccountId());
                idem.setDestinationAccountId(dest.getAccountId());
                idem.setAmountCents(hold.getAmountCents());
                idem.setCurrency(hold.getCurrency());
                idem.setFirstExecutedAt(System.currentTimeMillis());
                idem.setLastObservedAt(System.currentTimeMillis());
                idem.setLastOutcome(IdempotencyRecord.OUTCOME_EXECUTED);

                RaftNode.BatchExecution execution = raftNode.executeBatchIndexed(startIndex -> {
                    result.setRaftLogIndex(startIndex);
                    idem.setOriginalRaftLogIndex(startIndex);
                    return List.of(Command.multiPut(List.of(
                            new MultiPutPayload.Entry(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                            new MultiPutPayload.Entry(accountKey(effectiveTenant, dest.getAccountId()), dest.toJsonBytes()),
                            new MultiPutPayload.Entry(holdKey(effectiveTenant, holdId), hold.toJsonBytes()),
                            new MultiPutPayload.Entry(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                            new MultiPutPayload.Entry(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)),
                            new MultiPutPayload.Entry(idemKey(effectiveTenant, idempKey), idem.toJsonBytes())
                    ), idemFingerprintKey(effectiveTenant, idempKey), fingerprint.getBytes(StandardCharsets.UTF_8)));
                }).get(15, TimeUnit.SECONDS);

                ApplyResult apply = execution.results().isEmpty() ? null : execution.results().get(0);
                if (apply != null && !apply.isSuccess()) {
                    if (MultiPutPayload.REJECT_DUPLICATE.equals(apply.getError())) {
                        PaymentResult cached = readCachedReceipt(effectiveTenant, idempKey);
                        if (cached != null) {
                            cached.setIdempotentReplay(true);
                            totalIdempotentReplays.incrementAndGet();
                            bumpReplayCount(effectiveTenant, idempKey, readIdempotencyRecord(effectiveTenant, idempKey));
                            return cached;
                        }
                    } else if (MultiPutPayload.REJECT_CONFLICT.equals(apply.getError())) {
                        return conflictOutcome(idempKey, fingerprint, readIdempotencyRecord(effectiveTenant, idempKey), effectiveTenant);
                    }
                    throw new IllegalStateException("Capture batch rejected by state machine: " + apply.getError());
                }

                totalSettledCount.incrementAndGet();
                totalSettledVolumeCents.addAndGet(hold.getAmountCents());
                log.info("Captured hold {} into settled payment {} at raft index {}", holdId, pmtRef, execution.startIndex());
                return result;
            } catch (Exception e) {
                if (e instanceof RuntimeException re) throw re;
                throw new CompletionException(e);
            }
        });
    }

    /**
     * Voids / releases an active authorization hold.
     */
    public CompletableFuture<Boolean> voidHold(String holdId, String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";

        return CompletableFuture.supplyAsync(() -> {
            try {
                byte[] holdBytes = readState(holdKey(effectiveTenant, holdId));
                if (holdBytes == null || holdBytes.length == 0) {
                    throw new NoSuchElementException("Hold not found: " + holdId);
                }
                PaymentHold hold = PaymentHold.fromJsonBytes(holdBytes);
                if (hold.getStatus() != PaymentStatus.AUTHORIZED) {
                    return false;
                }

                PaymentAccount source = loadAccount(hold.getSourceAccountId(), effectiveTenant);
                if (source != null) {
                    source.setReservedCents(Math.max(0, source.getReservedCents() - hold.getAmountCents()));
                    source.setUpdatedAt(System.currentTimeMillis());
                }

                hold.setStatus(PaymentStatus.VOIDED);

                List<Command> batch = new ArrayList<>();
                if (source != null) {
                    batch.add(Command.put(accountKey(effectiveTenant, hold.getSourceAccountId()), source.toJsonBytes()));
                }
                batch.add(Command.put(holdKey(effectiveTenant, holdId), hold.toJsonBytes()));

                raftNode.executeBatch(batch).get(15, TimeUnit.SECONDS);
                log.info("Voided authorization hold {}", holdId);
                return true;
            } catch (Exception e) {
                if (e instanceof RuntimeException re) throw re;
                throw new CompletionException(e);
            }
        });
    }

    /**
     * Performs a linearizable read of an account balance (enforcing ReadIndex consensus).
     */
    public CompletableFuture<PaymentAccount> getAccount(String accountId, String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String key = accountKey(effectiveTenant, accountId);

        return raftNode.readLinearizable(key).thenApply(bytes -> {
            if (bytes == null || bytes.length == 0) {
                // Fallback to local state machine read
                bytes = raftNode.getStateMachine().get(key);
            }
            if (bytes == null || bytes.length == 0) {
                return null;
            }
            try {
                return PaymentAccount.fromJsonBytes(bytes);
            } catch (IOException e) {
                throw new CompletionException("Failed to decode PaymentAccount", e);
            }
        });
    }

    /**
     * Lists all payment accounts under a tenant.
     */
    public List<PaymentAccount> listAccounts(String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String prefix = "pay:acc:" + effectiveTenant + ":";
        Map<String, byte[]> scan = raftNode.getStateMachine().scan(prefix, prefix + "\uffff", 1000);
        List<PaymentAccount> accounts = new ArrayList<>();
        for (byte[] b : scan.values()) {
            try {
                accounts.add(PaymentAccount.fromJsonBytes(b));
            } catch (Exception ignored) {}
        }
        return accounts;
    }

    /**
     * Lists active or recent authorization holds under a tenant.
     */
    public List<PaymentHold> listHolds(String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String prefix = "pay:hold:" + effectiveTenant + ":";
        Map<String, byte[]> scan = raftNode.getStateMachine().scan(prefix, prefix + "\uffff", 200);
        List<PaymentHold> list = new ArrayList<>();
        for (byte[] b : scan.values()) {
            try {
                list.add(PaymentHold.fromJsonBytes(b));
            } catch (Exception ignored) {}
        }
        return list;
    }

    /**
     * Retrieves an authorization hold by its ID.
     */
    public Optional<PaymentHold> getHold(String holdId, String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        byte[] bytes = readState(holdKey(effectiveTenant, holdId));
        if (bytes != null && bytes.length > 0) {
            try {
                return Optional.of(PaymentHold.fromJsonBytes(bytes));
            } catch (Exception ignored) {}
        }
        return Optional.empty();
    }

    /**
     * Seeds initial demo accounts if the account registry is empty.
     */
    public CompletableFuture<Void> seedDefaultAccountsIfEmpty(String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        List<PaymentAccount> existing = listAccounts(effectiveTenant);
        if (!existing.isEmpty()) {
            return CompletableFuture.completedFuture(null);
        }

        return CompletableFuture.runAsync(() -> {
            try {
                createAccount("acc_alice_fednow", effectiveTenant, "USD", 100_000,
                        Map.of("holder", "Alice Smith", "type", "Consumer Checking", "routingNumber", "121000358")).get(5, TimeUnit.SECONDS);

                createAccount("acc_bob_fednow", effectiveTenant, "USD", 25_000,
                        Map.of("holder", "Bob Jones Corp", "type", "Merchant Operating", "routingNumber", "021000021")).get(5, TimeUnit.SECONDS);

                createAccount("acc_charlie_sepa", effectiveTenant, "EUR", 250_000,
                        Map.of("holder", "Charlie Dupont SARL", "type", "European Supplier", "iban", "FR7630006000011234567890189")).get(5, TimeUnit.SECONDS);

                createAccount("acc_deepak_upi", effectiveTenant, "INR", 7_500_000,
                        Map.of("holder", "Deepak Patel Ltd", "type", "Tech Enterprise", "vpa", "deepak@okicici")).get(5, TimeUnit.SECONDS);

                createAccount("acc_acme_corp", effectiveTenant, "USD", 5_000_000,
                        Map.of("holder", "Acme Global Treasury", "type", "Institutional Clearing", "routingNumber", "111000025")).get(5, TimeUnit.SECONDS);

                log.info("Successfully seeded demo FinTech accounts for tenant {}", effectiveTenant);
            } catch (Exception e) {
                log.warn("Account auto-seed had partial issue: {}", e.getMessage());
            }
        });
    }

    /**
     * Retrieves an immutable payment receipt by transaction reference or idempotency key.
     */
    public Optional<PaymentResult> getTransaction(String refOrIdempKey, String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        byte[] bytes = readState(txKey(effectiveTenant, refOrIdempKey));
        if (bytes == null || bytes.length == 0) {
            byte[] refTarget = readState(refKey(effectiveTenant, refOrIdempKey));
            if (refTarget != null && refTarget.length > 0) {
                String actualIdemp = new String(refTarget, StandardCharsets.UTF_8);
                bytes = readState(txKey(effectiveTenant, actualIdemp));
            }
        }
        if (bytes != null && bytes.length > 0) {
            try {
                return Optional.of(PaymentResult.fromJsonBytes(bytes));
            } catch (Exception ignored) {}
        }
        return Optional.empty();
    }

    /**
     * Lists recent payment transactions.
     */
    public List<PaymentResult> listTransactions(String tenantId, int limit) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String prefix = "pay:tx:" + effectiveTenant + ":";
        int max = limit > 0 ? limit : 50;
        Map<String, byte[]> scan = raftNode.getStateMachine().scan(prefix, prefix + "\uffff", max);
        List<PaymentResult> list = new ArrayList<>();
        for (byte[] b : scan.values()) {
            try {
                list.add(PaymentResult.fromJsonBytes(b));
            } catch (Exception ignored) {}
        }
        return list;
    }

    /**
     * Lists replicated idempotency records for a tenant, newest observation first.
     */
    public List<IdempotencyRecord> listIdempotencyRecords(String tenantId, int limit) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        String prefix = "pay:idem:" + effectiveTenant + ":";
        int max = limit > 0 ? limit : 200;
        Map<String, byte[]> scan = raftNode.getStateMachine().scan(prefix, prefix + "\uffff", max);
        List<IdempotencyRecord> list = new ArrayList<>();
        for (byte[] b : scan.values()) {
            try {
                list.add(IdempotencyRecord.fromJsonBytes(b));
            } catch (Exception ignored) {}
        }
        list.sort(Comparator.comparingLong(IdempotencyRecord::getLastObservedAt).reversed());
        return list;
    }

    /**
     * Retrieves the replicated idempotency record for a single key.
     */
    public Optional<IdempotencyRecord> getIdempotencyRecord(String idempotencyKey, String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        byte[] bytes = readState(idemKey(effectiveTenant, idempotencyKey));
        if (bytes != null && bytes.length > 0) {
            try {
                return Optional.of(IdempotencyRecord.fromJsonBytes(bytes));
            } catch (Exception ignored) {}
        }
        return Optional.empty();
    }

    /**
     * Returns operational metrics of the settlement switch.
     */
    public Map<String, Object> getMetrics(String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("totalSettledCount", totalSettledCount.get());
        map.put("totalSettledVolumeCents", totalSettledVolumeCents.get());
        map.put("totalRejectedCount", totalRejectedCount.get());
        map.put("totalIdempotentReplays", totalIdempotentReplays.get());
        map.put("totalIdempotencyConflicts", totalIdempotencyConflicts.get());
        map.put("activeAccountsCount", listAccounts(effectiveTenant).size());
        map.put("idempotencyRecordCount", listIdempotencyRecords(effectiveTenant, 1000).size());
        return map;
    }

    // Helper methods

    /**
     * Builds the deterministic outcome for an idempotency key that was reused with a
     * different payload. The original receipt is never overwritten.
     */
    private PaymentResult conflictOutcome(String idempKey, String fingerprint, IdempotencyRecord record, String tenantId) {
        totalIdempotencyConflicts.incrementAndGet();
        String originalOperation = record != null ? record.getOperation() : "UNKNOWN";
        log.warn("Idempotency key {} reused with a different payload (original operation {}). Rejecting.",
                idempKey, originalOperation);
        bumpConflictCount(tenantId, idempKey, record);
        PaymentResult conflict = PaymentResult.rejected(
                "pmt_conflict_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12),
                idempKey,
                PaymentRail.INTERNAL_BOOK,
                record != null ? record.getSourceAccountId() : null,
                record != null ? record.getDestinationAccountId() : null,
                record != null ? record.getAmountCents() : 0L,
                record != null ? record.getCurrency() : "USD",
                REASON_IDEMPOTENCY_CONFLICT,
                raftNode.getLastApplied() + 1
        );
        return conflict;
    }

    /**
     * Reads the replicated idempotency record for a key.
     */
    private IdempotencyRecord readIdempotencyRecord(String tenantId, String idempotencyKey) {
        byte[] bytes = readState(idemKey(tenantId, idempotencyKey));
        if (bytes != null && bytes.length > 0) {
            try {
                return IdempotencyRecord.fromJsonBytes(bytes);
            } catch (Exception ignored) {}
        }
        return null;
    }

    /**
     * Reads the cached settlement receipt for an idempotency key.
     */
    private PaymentResult readCachedReceipt(String tenantId, String idempotencyKey) {
        byte[] bytes = readState(txKey(tenantId, idempotencyKey));
        if (bytes != null && bytes.length > 0) {
            try {
                return PaymentResult.fromJsonBytes(bytes);
            } catch (Exception ignored) {}
        }
        return null;
    }

    /**
     * Best-effort increment of the replay counter for an idempotency key. Uses a compare and
     * swap so that concurrent replays cannot lose each other's increments. Observability
     * bookkeeping must never fail an otherwise successful replay.
     */
    private void bumpReplayCount(String tenantId, String idempotencyKey, IdempotencyRecord record) {
        if (record == null) {
            return;
        }
        try {
            IdempotencyRecord updated = copyOf(record);
            updated.setReplayCount(record.getReplayCount() + 1);
            updated.setLastObservedAt(System.currentTimeMillis());
            updated.setLastOutcome(IdempotencyRecord.OUTCOME_REPLAYED);
            long version = currentVersion(idemKey(tenantId, idempotencyKey));
            raftNode.execute(Command.cas(idemKey(tenantId, idempotencyKey), version, updated.toJsonBytes(), "", 0L))
                    .get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.debug("Replay counter update skipped for key {}: {}", idempotencyKey, e.toString());
        }
    }

    /**
     * Best-effort increment of the payload-conflict counter for an idempotency key.
     */
    private void bumpConflictCount(String tenantId, String idempotencyKey, IdempotencyRecord record) {
        if (record == null) {
            return;
        }
        try {
            IdempotencyRecord updated = copyOf(record);
            updated.setConflictCount(record.getConflictCount() + 1);
            updated.setLastObservedAt(System.currentTimeMillis());
            updated.setLastOutcome(IdempotencyRecord.OUTCOME_CONFLICT);
            long version = currentVersion(idemKey(tenantId, idempotencyKey));
            raftNode.execute(Command.cas(idemKey(tenantId, idempotencyKey), version, updated.toJsonBytes(), "", 0L))
                    .get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            log.debug("Conflict counter update skipped for key {}: {}", idempotencyKey, e.toString());
        }
    }

    private long currentVersion(String key) {
        VersionedValue versioned = raftNode.getStateMachine().getVersioned(key);
        return versioned != null ? versioned.version() : 0L;
    }

    private IdempotencyRecord copyOf(IdempotencyRecord record) {
        try {
            return IdempotencyRecord.fromJsonBytes(record.toJsonBytes());
        } catch (IOException e) {
            throw new CompletionException(e);
        }
    }

    private PaymentAccount loadAccount(String accountId, String tenantId) {
        byte[] bytes = readState(accountKey(tenantId, accountId));
        if (bytes == null || bytes.length == 0) return null;
        try {
            return PaymentAccount.fromJsonBytes(bytes);
        } catch (IOException e) {
            return null;
        }
    }

    /**
     * Commits a rejection receipt. The rejection never touches account balances, but it does
     * claim the idempotency key so that a retry with the same payload observes the exact same
     * rejection, and a retry with a different payload is reported as a conflict.
     */
    private PaymentResult commitRejection(String pmtRef, PaymentInstruction inst, String fingerprint,
                                          String reason, String tenantId) {
        totalRejectedCount.incrementAndGet();
        PaymentResult rejected = PaymentResult.rejected(
                pmtRef, inst.getIdempotencyKey(), inst.getRail(),
                inst.getSourceAccountId(), inst.getDestinationAccountId(),
                inst.getAmountCents(), inst.getCurrency(), reason, raftNode.getLastApplied() + 1
        );
        try {
            IdempotencyRecord idem = new IdempotencyRecord(inst.getIdempotencyKey(), tenantId,
                    IdempotencyRecord.OP_SETTLE, fingerprint);
            idem.setPaymentRef(pmtRef);
            idem.setStatus(PaymentStatus.REJECTED.name());
            idem.setRail(inst.getRail() != null ? inst.getRail().name() : PaymentRail.INTERNAL_BOOK.name());
            idem.setSourceAccountId(inst.getSourceAccountId());
            idem.setDestinationAccountId(inst.getDestinationAccountId());
            idem.setAmountCents(inst.getAmountCents());
            idem.setCurrency(inst.getCurrency());
            idem.setFirstExecutedAt(System.currentTimeMillis());
            idem.setLastObservedAt(System.currentTimeMillis());
            idem.setLastOutcome(IdempotencyRecord.OUTCOME_REJECTED);
            idem.setRejectionReason(reason);

            raftNode.executeBatchIndexed(startIndex -> {
                rejected.setRaftLogIndex(startIndex);
                idem.setOriginalRaftLogIndex(startIndex);
                return List.of(Command.multiPut(List.of(
                        new MultiPutPayload.Entry(txKey(tenantId, inst.getIdempotencyKey()), rejected.toJsonBytes()),
                        new MultiPutPayload.Entry(refKey(tenantId, pmtRef), inst.getIdempotencyKey().getBytes(StandardCharsets.UTF_8)),
                        new MultiPutPayload.Entry(idemFingerprintKey(tenantId, inst.getIdempotencyKey()), fingerprint.getBytes(StandardCharsets.UTF_8)),
                        new MultiPutPayload.Entry(idemKey(tenantId, inst.getIdempotencyKey()), idem.toJsonBytes())
                ), idemFingerprintKey(tenantId, inst.getIdempotencyKey()), fingerprint.getBytes(StandardCharsets.UTF_8)));
            }).get(5, TimeUnit.SECONDS);
        } catch (Exception ignored) {
            // The rejection is still returned to the caller even if the receipt could not be persisted.
        }
        log.warn("Payment {} rejected: {}", inst.getIdempotencyKey(), reason);
        return rejected;
    }

    private byte[] readState(String key) {
        return raftNode.getStateMachine().get(key);
    }

    private String accountKey(String tenantId, String accountId) {
        return "pay:acc:" + tenantId + ":" + accountId;
    }

    private String txKey(String tenantId, String idempKey) {
        return "pay:tx:" + tenantId + ":" + idempKey;
    }

    private String refKey(String tenantId, String pmtRef) {
        return "pay:ref:" + tenantId + ":" + pmtRef;
    }

    private String holdKey(String tenantId, String holdId) {
        return "pay:hold:" + tenantId + ":" + holdId;
    }

    /**
     * Key of the replicated idempotency record.
     */
    private String idemKey(String tenantId, String idempKey) {
        return "pay:idem:" + tenantId + ":" + idempKey;
    }

    /**
     * Key of the replicated request fingerprint. Guarding on this key is what makes the
     * duplicate-vs-conflict decision atomic inside the state machine.
     */
    private String idemFingerprintKey(String tenantId, String idempKey) {
        return "pay:idemfp:" + tenantId + ":" + idempKey;
    }

    @Override
    public void close() {
        // cleanup if needed
    }
}
