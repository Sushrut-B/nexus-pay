package io.raftline.testkit;

import io.raftline.core.NotLeaderException;
import io.raftline.core.RaftNode;
import io.raftline.core.payment.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies the financial correctness guarantees of the settlement switch:
 * <ul>
 *   <li>an idempotency key can never produce a second debit;</li>
 *   <li>an idempotency key reused with a different payload is rejected, not replayed;</li>
 *   <li>the decision is enforced inside the replicated state machine, so it holds under
 *       concurrency;</li>
 *   <li>the ledger value is conserved and the available balance invariant holds.</li>
 * </ul>
 */
class PaymentIdempotencyTest {

    private ClusterSimulator cluster;

    @AfterEach
    void tearDown() throws Exception {
        if (cluster != null) {
            cluster.close();
        }
    }

    private PaymentInstruction instruction(String key, long amountCents, String currency, String rail) {
        return new PaymentInstruction(
                key,
                PaymentRail.fromString(rail),
                "acc_sender",
                "acc_receiver",
                amountCents,
                currency,
                "Idempotency test",
                "default",
                null);
    }

    /**
     * Runs an operation against whichever node currently holds leadership, retrying when
     * leadership moves mid-test. The simulator uses real election timers, so a leader
     * captured at the start of a test can legitimately step down while it runs.
     */
    private <T> T onLeader(ThrowingSupplier<T> operation) throws Exception {
        NotLeaderException last = null;
        for (int attempt = 0; attempt < 8; attempt++) {
            RaftNode leader = cluster.waitForLeader(5_000);
            try {
                return operation.get(leader);
            } catch (Exception e) {
                NotLeaderException nle = unwrapNotLeader(e);
                if (nle == null) {
                    throw e;
                }
                last = nle;
                Thread.sleep(200);
            }
        }
        throw last != null ? last : new IllegalStateException("No leader became available");
    }

    /**
     * Unwraps the {@link ExecutionException} / {@link java.util.concurrent.CompletionException}
     * chain that the asynchronous engine wraps around a leadership change.
     */
    private NotLeaderException unwrapNotLeader(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof NotLeaderException nle) {
                return nle;
            }
            current = current.getCause();
        }
        return null;
    }

    @FunctionalInterface
    private interface ThrowingSupplier<T> {
        T get(RaftNode leader) throws Exception;
    }

    @Test
    void testSameKeyWithDifferentPayloadIsRejected(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(5000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_sender", "default", "USD", 50_000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_receiver", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        String key = "reused-key-1";
        PaymentResult first = engine.settlePayment(instruction(key, 1_000L, "USD", "FEDNOW")).get(5, TimeUnit.SECONDS);
        assertThat(first.getStatus()).isEqualTo(PaymentStatus.SETTLED);
        assertThat(first.isIdempotentReplay()).isFalse();

        // Same key, materially different payload -> must be rejected, never replayed.
        PaymentResult conflicting = engine.settlePayment(instruction(key, 4_000L, "USD", "FEDNOW")).get(5, TimeUnit.SECONDS);
        assertThat(conflicting.getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(conflicting.getRejectionReason())
                .isEqualTo(PaymentSettlementEngine.REASON_IDEMPOTENCY_CONFLICT);

        // The original receipt must be preserved verbatim.
        Optional<PaymentResult> original = engine.getTransaction(key, "default");
        assertThat(original).isPresent();
        assertThat(original.get().getPaymentRef()).isEqualTo(first.getPaymentRef());
        assertThat(original.get().getAmountCents()).isEqualTo(1_000L);
        assertThat(original.get().getRaftLogIndex()).isEqualTo(first.getRaftLogIndex());

        // Exactly one debit happened.
        PaymentAccount sender = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        PaymentAccount receiver = engine.getAccount("acc_receiver", "default").get(5, TimeUnit.SECONDS);
        assertThat(sender.getBalanceCents()).isEqualTo(49_000L);
        assertThat(receiver.getBalanceCents()).isEqualTo(1_000L);
    }

    @Test
    void testConcurrentIdenticalSubmissionsDebitExactlyOnce(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(5000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_sender", "default", "USD", 100_000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_receiver", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        String key = "concurrent-key-1";
        int concurrency = 8;
        ExecutorService executor = Executors.newFixedThreadPool(concurrency);
        CountDownLatch startGate = new CountDownLatch(1);
        List<Future<PaymentResult>> futures = new ArrayList<>();
        for (int i = 0; i < concurrency; i++) {
            futures.add(executor.submit(() -> {
                startGate.await(5, TimeUnit.SECONDS);
                return engine.settlePayment(instruction(key, 2_500L, "USD", "SEPA_INSTANT")).get(10, TimeUnit.SECONDS);
            }));
        }
        startGate.countDown();

        Set<String> refs = new HashSet<>();
        for (Future<PaymentResult> f : futures) {
            PaymentResult r = f.get(15, TimeUnit.SECONDS);
            assertThat(r.getStatus()).isEqualTo(PaymentStatus.SETTLED);
            refs.add(r.getPaymentRef());
        }
        executor.shutdownNow();

        // All concurrent copies must resolve to exactly one payment reference.
        assertThat(refs).hasSize(1);

        PaymentAccount sender = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        PaymentAccount receiver = engine.getAccount("acc_receiver", "default").get(5, TimeUnit.SECONDS);
        assertThat(sender.getBalanceCents()).isEqualTo(97_500L);
        assertThat(receiver.getBalanceCents()).isEqualTo(2_500L);
    }

    @Test
    void testIdempotencyLedgerRecordsReplayAndOriginalLogIndex(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(5000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_sender", "default", "USD", 50_000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_receiver", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        String key = "ledger-key-1";
        PaymentResult original = engine.settlePayment(instruction(key, 1_500L, "USD", "FEDNOW")).get(5, TimeUnit.SECONDS);
        assertThat(original.getRaftLogIndex()).isPositive();

        for (int i = 0; i < 3; i++) {
            PaymentResult replay = engine.settlePayment(instruction(key, 1_500L, "USD", "FEDNOW")).get(5, TimeUnit.SECONDS);
            assertThat(replay.isIdempotentReplay()).isTrue();
            assertThat(replay.getPaymentRef()).isEqualTo(original.getPaymentRef());
            assertThat(replay.getRaftLogIndex()).isEqualTo(original.getRaftLogIndex());
        }

        Optional<IdempotencyRecord> record = engine.getIdempotencyRecord(key, "default");
        assertThat(record).isPresent();
        assertThat(record.get().getOperation()).isEqualTo(IdempotencyRecord.OP_SETTLE);
        assertThat(record.get().getPaymentRef()).isEqualTo(original.getPaymentRef());
        assertThat(record.get().getOriginalRaftLogIndex()).isEqualTo(original.getRaftLogIndex());
        assertThat(record.get().getRequestFingerprint()).isNotBlank();
        assertThat(record.get().getReplayCount()).isGreaterThanOrEqualTo(1L);
        assertThat(record.get().getLastOutcome()).isEqualTo(IdempotencyRecord.OUTCOME_REPLAYED);

        List<IdempotencyRecord> records = engine.listIdempotencyRecords("default", 50);
        assertThat(records).isNotEmpty();
        assertThat(records).anyMatch(r -> key.equals(r.getIdempotencyKey()));
    }

    @Test
    void testLedgerValueIsConservedAndAvailableBalanceInvariantHolds(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(5000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_sender", "default", "USD", 50_000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_receiver", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        long totalBefore = engine.listAccounts("default").stream().mapToLong(PaymentAccount::getBalanceCents).sum();

        PaymentResult settled = onLeader(node -> node.getPaymentEngine()
                .settlePayment(instruction("conservation-1", 7_777L, "USD", "FEDNOW"))
                .get(5, TimeUnit.SECONDS));
        assertThat(settled.getStatus()).isEqualTo(PaymentStatus.SETTLED);

        long totalAfter = engine.listAccounts("default").stream().mapToLong(PaymentAccount::getBalanceCents).sum();
        assertThat(totalAfter).isEqualTo(totalBefore);

        // Phase 1: reserve. Available must drop, ledger balance must not.
        PaymentResult auth = onLeader(node -> node.getPaymentEngine()
                .authorizeHold(
                        new PaymentInstruction("hold-1", PaymentRail.INTERNAL_BOOK, "acc_sender", "acc_receiver",
                                3_000L, "USD", "reserve", "default", null),
                        "hld_invariant_1", 600_000L)
                .get(5, TimeUnit.SECONDS));
        assertThat(auth.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);

        PaymentAccount sender = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        assertThat(sender.getAvailableBalanceCents())
                .isEqualTo(sender.getBalanceCents() - sender.getReservedCents());
        assertThat(sender.getReservedCents()).isEqualTo(3_000L);

        // Phase 2: capture. Reserved funds are released and the ledger moves exactly once.
        onLeader(node -> node.getPaymentEngine()
                .captureHold("hld_invariant_1", "default", "capture-1")
                .get(5, TimeUnit.SECONDS));

        PaymentAccount senderFinal = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        PaymentAccount receiverFinal = engine.getAccount("acc_receiver", "default").get(5, TimeUnit.SECONDS);
        assertThat(senderFinal.getReservedCents()).isEqualTo(0L);
        assertThat(senderFinal.getAvailableBalanceCents())
                .isEqualTo(senderFinal.getBalanceCents() - senderFinal.getReservedCents());

        long totalFinal = engine.listAccounts("default").stream().mapToLong(PaymentAccount::getBalanceCents).sum();
        assertThat(totalFinal).isEqualTo(totalBefore);
        assertThat(receiverFinal.getBalanceCents()).isEqualTo(7_777L + 3_000L);
    }

    @Test
    void testRejectionDoesNotMutateBalancesAndIsIdempotent(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(5000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_sender", "default", "USD", 1_000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_receiver", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        String key = "reject-key-1";
        PaymentResult rejected = engine.settlePayment(instruction(key, 9_000L, "USD", "UPI")).get(5, TimeUnit.SECONDS);
        assertThat(rejected.getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(rejected.getRejectionReason()).isEqualTo("INSUFFICIENT_FUNDS");

        PaymentAccount sender = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        assertThat(sender.getBalanceCents()).isEqualTo(1_000L);

        // A replay of the rejected request returns the identical rejection.
        PaymentResult replay = engine.settlePayment(instruction(key, 9_000L, "USD", "UPI")).get(5, TimeUnit.SECONDS);
        assertThat(replay.getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(replay.getRejectionReason()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(replay.getPaymentRef()).isEqualTo(rejected.getPaymentRef());

        // Reusing the rejected key with a different payload is a conflict, not a new payment.
        PaymentResult conflict = engine.settlePayment(instruction(key, 500L, "USD", "UPI")).get(5, TimeUnit.SECONDS);
        assertThat(conflict.getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(conflict.getRejectionReason())
                .isEqualTo(PaymentSettlementEngine.REASON_IDEMPOTENCY_CONFLICT);

        PaymentAccount senderAfter = engine.getAccount("acc_sender", "default").get(5, TimeUnit.SECONDS);
        assertThat(senderAfter.getBalanceCents()).isEqualTo(1_000L);
    }
}
