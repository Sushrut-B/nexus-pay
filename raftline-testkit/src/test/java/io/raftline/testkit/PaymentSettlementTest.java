package io.raftline.testkit;

import io.raftline.core.RaftNode;
import io.raftline.core.payment.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.util.*;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.assertThat;

class PaymentSettlementTest {

    private ClusterSimulator cluster;

    @AfterEach
    void tearDown() throws Exception {
        if (cluster != null) {
            cluster.close();
        }
    }

    @Test
    void testInstantPaymentSettlementAndIdempotency(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(3000);
        assertThat(leader).isNotNull();

        PaymentSettlementEngine engine = leader.getPaymentEngine();
        assertThat(engine).isNotNull();

        // 1. Create accounts
        PaymentAccount alice = engine.createAccount("acc_alice", "tenant_bank_a", "USD", 50000L, Map.of("holder", "Alice Smith")).get(5, TimeUnit.SECONDS);
        PaymentAccount bob = engine.createAccount("acc_bob", "tenant_bank_a", "USD", 10000L, Map.of("holder", "Bob Jones")).get(5, TimeUnit.SECONDS);

        assertThat(alice.getBalanceCents()).isEqualTo(50000L);
        assertThat(bob.getBalanceCents()).isEqualTo(10000L);

        // 2. Settle payment from Alice to Bob: $150.00 (15,000 cents) via FEDNOW
        String idempKey = "pmt_fednow_" + UUID.randomUUID();
        PaymentInstruction inst = new PaymentInstruction(
                idempKey,
                PaymentRail.FEDNOW,
                "acc_alice",
                "acc_bob",
                15000L,
                "USD",
                "Dinner split",
                "tenant_bank_a",
                null
        );

        PaymentResult result = engine.settlePayment(inst).get(5, TimeUnit.SECONDS);
        assertThat(result.getStatus()).isEqualTo(PaymentStatus.SETTLED);
        assertThat(result.getRail()).isEqualTo(PaymentRail.FEDNOW);
        assertThat(result.isIdempotentReplay()).isFalse();
        assertThat(result.getSourceBalanceAfter()).isEqualTo(35000L);
        assertThat(result.getDestinationBalanceAfter()).isEqualTo(25000L);

        // 3. FLAKY NETWORK TEST: Replay the identical payment 5 times concurrently
        ExecutorService executor = Executors.newFixedThreadPool(5);
        List<Future<PaymentResult>> futures = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            futures.add(executor.submit(() -> engine.settlePayment(inst).get(5, TimeUnit.SECONDS)));
        }

        for (Future<PaymentResult> f : futures) {
            PaymentResult replayed = f.get(5, TimeUnit.SECONDS);
            assertThat(replayed.getStatus()).isEqualTo(PaymentStatus.SETTLED);
            assertThat(replayed.isIdempotentReplay()).isTrue();
            assertThat(replayed.getPaymentRef()).isEqualTo(result.getPaymentRef());
        }
        executor.shutdown();

        // 4. Verify balances: Alice MUST have been debited exactly once (35,000 cents), Bob credited once (25,000 cents)
        PaymentAccount aliceAfter = engine.getAccount("acc_alice", "tenant_bank_a").get(5, TimeUnit.SECONDS);
        PaymentAccount bobAfter = engine.getAccount("acc_bob", "tenant_bank_a").get(5, TimeUnit.SECONDS);

        assertThat(aliceAfter.getBalanceCents()).isEqualTo(35000L);
        assertThat(bobAfter.getBalanceCents()).isEqualTo(25000L);
    }

    @Test
    void testInsufficientFundsOverdraftPrevention(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(3000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_user1", "default", "USD", 2000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_user2", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        // Try to transfer $50.00 (5,000 cents) when balance is only $20.00 (2,000 cents)
        String idempKey = "pmt_overdraft_check";
        PaymentInstruction overdraw = new PaymentInstruction(
                idempKey,
                PaymentRail.UPI,
                "acc_user1",
                "acc_user2",
                5000L,
                "USD",
                "Overdraft attempt",
                "default",
                null
        );

        PaymentResult rej = engine.settlePayment(overdraw).get(5, TimeUnit.SECONDS);
        assertThat(rej.getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(rej.getRejectionReason()).isEqualTo("INSUFFICIENT_FUNDS");

        // Verify balances remain untouched
        PaymentAccount acc1 = engine.getAccount("acc_user1", "default").get(5, TimeUnit.SECONDS);
        PaymentAccount acc2 = engine.getAccount("acc_user2", "default").get(5, TimeUnit.SECONDS);
        assertThat(acc1.getBalanceCents()).isEqualTo(2000L);
        assertThat(acc2.getBalanceCents()).isEqualTo(0L);

        // Verify re-querying the rejected payment returns the exact cached rejection
        Optional<PaymentResult> cached = engine.getTransaction(idempKey, "default");
        assertThat(cached).isPresent();
        assertThat(cached.get().getStatus()).isEqualTo(PaymentStatus.REJECTED);
        assertThat(cached.get().getRejectionReason()).isEqualTo("INSUFFICIENT_FUNDS");
    }

    @Test
    void testTwoPhaseAuthorizationHoldAndCapture(@TempDir File tempDir) throws Exception {
        cluster = new ClusterSimulator(tempDir, 3);
        RaftNode leader = cluster.waitForLeader(3000);
        PaymentSettlementEngine engine = leader.getPaymentEngine();

        engine.createAccount("acc_cardholder", "default", "USD", 10000L, null).get(5, TimeUnit.SECONDS);
        engine.createAccount("acc_merchant", "default", "USD", 0L, null).get(5, TimeUnit.SECONDS);

        // Phase 1: Authorize hold for $40.00 (4,000 cents)
        String holdId = "hld_gas_pump_1";
        PaymentInstruction authInst = new PaymentInstruction(
                "auth_tx_1",
                PaymentRail.SEPA_INSTANT,
                "acc_cardholder",
                "acc_merchant",
                4000L,
                "USD",
                "Gas pump authorization hold",
                "default",
                null
        );

        PaymentResult authRes = engine.authorizeHold(authInst, holdId, 3600_000L).get(5, TimeUnit.SECONDS);
        assertThat(authRes.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);

        // Verify available balance decreased, but ledger balance unchanged yet
        PaymentAccount ch = engine.getAccount("acc_cardholder", "default").get(5, TimeUnit.SECONDS);
        assertThat(ch.getBalanceCents()).isEqualTo(10000L);
        assertThat(ch.getReservedCents()).isEqualTo(4000L);
        assertThat(ch.getAvailableBalanceCents()).isEqualTo(6000L);

        // Phase 2: Capture the hold into settled transfer
        PaymentResult capRes = engine.captureHold(holdId, "default", "cap_tx_1").get(5, TimeUnit.SECONDS);
        assertThat(capRes.getStatus()).isEqualTo(PaymentStatus.SETTLED);
        assertThat(capRes.getSourceBalanceAfter()).isEqualTo(6000L);
        assertThat(capRes.getDestinationBalanceAfter()).isEqualTo(4000L);

        PaymentAccount chFinal = engine.getAccount("acc_cardholder", "default").get(5, TimeUnit.SECONDS);
        PaymentAccount merchFinal = engine.getAccount("acc_merchant", "default").get(5, TimeUnit.SECONDS);
        assertThat(chFinal.getBalanceCents()).isEqualTo(6000L);
        assertThat(chFinal.getReservedCents()).isEqualTo(0L);
        assertThat(merchFinal.getBalanceCents()).isEqualTo(4000L);
    }
}

