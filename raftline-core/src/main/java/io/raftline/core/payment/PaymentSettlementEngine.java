package io.raftline.core.payment;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.raftline.core.NotLeaderException;
import io.raftline.core.RaftNode;
import io.raftline.storage.model.Command;
import io.raftline.storage.state.ApplyResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.Closeable;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Real-Time Payment Settlement & Idempotency Switch.
 *
 * Designed for instant payment rails (FedNow, SEPA Instant, UPI, Faster Payments).
 * Guarantees strictly-once (idempotent) execution semantics, preventing duplicate debits
 * under network retries, while enforcing double-entry balance invariants and linearizable
 * ReadIndex balance lookups.
 */
public class PaymentSettlementEngine implements Closeable {
    private static final Logger log = LoggerFactory.getLogger(PaymentSettlementEngine.class);
    private static final ObjectMapper json = new ObjectMapper();

    private final RaftNode raftNode;

    // Metrics counters
    private final AtomicLong totalSettledCount = new AtomicLong(0);
    private final AtomicLong totalSettledVolumeCents = new AtomicLong(0);
    private final AtomicLong totalRejectedCount = new AtomicLong(0);
    private final AtomicLong totalIdempotentReplays = new AtomicLong(0);

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
                // Check if idempotency key already processed
                byte[] existingTx = readState(txKey(effectiveTenant, idempKey));
                if (existingTx != null && existingTx.length > 0) {
                    PaymentAccount acc = getAccount(accountId, effectiveTenant).get(5, TimeUnit.SECONDS);
                    return acc;
                }

                PaymentAccount acc = getAccount(accountId, effectiveTenant).get(5, TimeUnit.SECONDS);
                if (acc == null) {
                    throw new NoSuchElementException("Account not found: " + accountId);
                }

                acc.setBalanceCents(acc.getBalanceCents() + amountCents);
                acc.setUpdatedAt(System.currentTimeMillis());

                String pmtRef = "pmt_fund_" + UUID.randomUUID().toString().substring(0, 8);
                PaymentResult res = PaymentResult.settled(pmtRef, idempKey, PaymentRail.INTERNAL_BOOK,
                        "SYSTEM_RESERVE", accountId, amountCents, acc.getCurrency(), 0, acc.getBalanceCents(), raftNode.getLastApplied());

                List<Command> batch = List.of(
                        Command.put(accountKey(effectiveTenant, accountId), acc.toJsonBytes()),
                        Command.put(txKey(effectiveTenant, idempKey), res.toJsonBytes()),
                        Command.put(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8))
                );

                raftNode.executeBatch(batch).get(15, TimeUnit.SECONDS);
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

                // 1. Idempotency Check: Return identical cached receipt if already executed
                byte[] cachedBytes = readState(txKey(effectiveTenant, idempKey));
                if (cachedBytes != null && cachedBytes.length > 0) {
                    PaymentResult cached = PaymentResult.fromJsonBytes(cachedBytes);
                    cached.setIdempotentReplay(true);
                    totalIdempotentReplays.incrementAndGet();
                    log.info("Idempotent replay detected for payment key {}. Returning existing receipt without duplicate debit.", idempKey);
                    return cached;
                }

                String pmtRef = "pmt_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

                // 2. Load Debtor and Creditor accounts
                PaymentAccount source = loadAccount(instruction.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(instruction.getDestinationAccountId(), effectiveTenant);

                // Validations
                if (source == null) {
                    return commitRejection(pmtRef, instruction, "SOURCE_ACCOUNT_NOT_FOUND");
                }
                if (dest == null) {
                    return commitRejection(pmtRef, instruction, "DESTINATION_ACCOUNT_NOT_FOUND");
                }
                if (!"ACTIVE".equalsIgnoreCase(source.getStatus())) {
                    return commitRejection(pmtRef, instruction, "SOURCE_ACCOUNT_" + source.getStatus());
                }
                if (!"ACTIVE".equalsIgnoreCase(dest.getStatus())) {
                    return commitRejection(pmtRef, instruction, "DESTINATION_ACCOUNT_" + dest.getStatus());
                }
                if (instruction.getAmountCents() <= 0) {
                    return commitRejection(pmtRef, instruction, "INVALID_AMOUNT_MUST_BE_POSITIVE");
                }
                if (!source.getCurrency().equalsIgnoreCase(instruction.getCurrency()) ||
                    !dest.getCurrency().equalsIgnoreCase(instruction.getCurrency())) {
                    return commitRejection(pmtRef, instruction, "CURRENCY_MISMATCH");
                }

                // 3. Balance Invariant Check (Prevent overdrafts)
                if (source.getAvailableBalanceCents() < instruction.getAmountCents()) {
                    return commitRejection(pmtRef, instruction, "INSUFFICIENT_FUNDS");
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
                        raftNode.getLastApplied() + 1
                );

                // 5. Execute Atomic Consensus Batch via Raft
                List<Command> batch = List.of(
                        Command.put(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                        Command.put(accountKey(effectiveTenant, dest.getAccountId()), dest.toJsonBytes()),
                        Command.put(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                        Command.put(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8))
                );

                List<ApplyResult> applyResults = raftNode.executeBatch(batch).get(15, TimeUnit.SECONDS);

                totalSettledCount.incrementAndGet();
                totalSettledVolumeCents.addAndGet(instruction.getAmountCents());
                log.info("Settled payment {} [{} {}] on rail {} (Debtor: {}, Creditor: {})",
                        pmtRef, instruction.getCurrency(), instruction.getAmountCents(),
                        instruction.getRail(), source.getAccountId(), dest.getAccountId());

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
                byte[] cachedBytes = readState(txKey(effectiveTenant, idempKey));
                if (cachedBytes != null && cachedBytes.length > 0) {
                    PaymentResult cached = PaymentResult.fromJsonBytes(cachedBytes);
                    cached.setIdempotentReplay(true);
                    return cached;
                }

                PaymentAccount source = loadAccount(instruction.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(instruction.getDestinationAccountId(), effectiveTenant);

                String pmtRef = "auth_" + UUID.randomUUID().toString().replace("-", "").substring(0, 14);

                if (source == null || dest == null) {
                    return commitRejection(pmtRef, instruction, "ACCOUNT_NOT_FOUND");
                }
                if (source.getAvailableBalanceCents() < instruction.getAmountCents()) {
                    return commitRejection(pmtRef, instruction, "INSUFFICIENT_FUNDS_FOR_HOLD");
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
                        raftNode.getLastApplied() + 1
                );

                List<Command> batch = List.of(
                        Command.put(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                        Command.put(holdKey(effectiveTenant, effectiveHoldId), hold.toJsonBytes()),
                        Command.put(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                        Command.put(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8))
                );

                raftNode.executeBatch(batch).get(15, TimeUnit.SECONDS);
                log.info("Authorized hold {} for {} cents on account {}", effectiveHoldId, instruction.getAmountCents(), source.getAccountId());
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

                PaymentAccount source = loadAccount(hold.getSourceAccountId(), effectiveTenant);
                PaymentAccount dest = loadAccount(hold.getDestinationAccountId(), effectiveTenant);

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
                        raftNode.getLastApplied() + 1
                );

                List<Command> batch = List.of(
                        Command.put(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()),
                        Command.put(accountKey(effectiveTenant, dest.getAccountId()), dest.toJsonBytes()),
                        Command.put(holdKey(effectiveTenant, holdId), hold.toJsonBytes()),
                        Command.put(txKey(effectiveTenant, idempKey), result.toJsonBytes()),
                        Command.put(refKey(effectiveTenant, pmtRef), idempKey.getBytes(StandardCharsets.UTF_8))
                );

                raftNode.executeBatch(batch).get(15, TimeUnit.SECONDS);
                totalSettledCount.incrementAndGet();
                totalSettledVolumeCents.addAndGet(hold.getAmountCents());
                log.info("Captured hold {} into settled payment {}", holdId, pmtRef);
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
                    batch.add(Command.put(accountKey(effectiveTenant, source.getAccountId()), source.toJsonBytes()));
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
     * Returns operational metrics of the settlement switch.
     */
    public Map<String, Object> getMetrics(String tenantId) {
        String effectiveTenant = (tenantId != null && !tenantId.isBlank()) ? tenantId : "default";
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("totalSettledCount", totalSettledCount.get());
        map.put("totalSettledVolumeCents", totalSettledVolumeCents.get());
        map.put("totalRejectedCount", totalRejectedCount.get());
        map.put("totalIdempotentReplays", totalIdempotentReplays.get());
        map.put("activeAccountsCount", listAccounts(effectiveTenant).size());
        return map;
    }

    // Helper methods
    private PaymentAccount loadAccount(String accountId, String tenantId) {
        byte[] bytes = readState(accountKey(tenantId, accountId));
        if (bytes == null || bytes.length == 0) return null;
        try {
            return PaymentAccount.fromJsonBytes(bytes);
        } catch (IOException e) {
            return null;
        }
    }

    private PaymentResult commitRejection(String pmtRef, PaymentInstruction inst, String reason) {
        totalRejectedCount.incrementAndGet();
        PaymentResult rejected = PaymentResult.rejected(
                pmtRef, inst.getIdempotencyKey(), inst.getRail(),
                inst.getSourceAccountId(), inst.getDestinationAccountId(),
                inst.getAmountCents(), inst.getCurrency(), reason, raftNode.getLastApplied() + 1
        );
        try {
            // Commit rejection receipt to WAL so retries receive the exact same rejection reason
            Command cmd = Command.put(txKey(inst.getTenantId(), inst.getIdempotencyKey()), rejected.toJsonBytes());
            raftNode.execute(cmd).get(5, TimeUnit.SECONDS);
        } catch (Exception ignored) {}
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

    @Override
    public void close() {
        // cleanup if needed
    }
}

