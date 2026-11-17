import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RaftlineError,
  type RaftlinePaymentsClient,
  type SettlePaymentInput,
} from "../../packages/api-client/src/index";
import { verifySettlementReceipt } from "../../apps/web/lib/payments/verify";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);

interface TestCustomer {
  userId: string;
  accountId: string;
  walletId: string;
  username: string;
}

let prisma: typeof import("../../packages/database/src/index")["prisma"];
let client: RaftlinePaymentsClient;
let tenantId: string;
let fundingService: typeof import("../../apps/web/lib/payments/funding-service");
let paymentService: typeof import("../../apps/web/lib/payments/payment-service");
let recipientService: typeof import("../../apps/web/lib/payments/recipient-service");
const created: TestCustomer[] = [];

beforeAll(async () => {
  if (!enabled) return;
  const envPath = path.resolve(process.cwd(), "apps/web/.env.local");
  dotenv.config({ path: envPath, override: false });

  const apiClient = await import("../../packages/api-client/src/index");
  ({ prisma } = await import("../../packages/database/src/index"));
  fundingService = await import("../../apps/web/lib/payments/funding-service");
  paymentService = await import("../../apps/web/lib/payments/payment-service");
  recipientService = await import("../../apps/web/lib/payments/recipient-service");

  const config = apiClient.loadRaftlineConfig(process.env as Record<string, string | undefined>);
  tenantId = config.tenantId;
  client = apiClient.createRaftlineClient({ config });
});

afterAll(async () => {
  if (!enabled || !client || !prisma) return;

  for (const customer of created) {
    await prisma.user.deleteMany({ where: { id: customer.userId } }).catch(() => undefined);
    try {
      const summary = await client.getClusterSummary();
      if (summary.leader) {
        const key = encodeURIComponent(`pay:acc:${tenantId}:${customer.accountId}`);
        await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
          method: "DELETE",
          headers: {
            "X-Client-Id": `nexuspay-r2-cleanup-${randomUUID()}`,
            "X-Sequence-Number": "1",
          },
        });
      }
    } catch {
      // Cleanup is best effort; the sandbox test account has no real-world value.
    }
  }
  await prisma.$disconnect().catch(() => undefined);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Raftline applies a per-tenant token bucket to settlements; back off on 429. */
async function settleWithRetry(input: SettlePaymentInput) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await client.settlePayment(input);
    } catch (error) {
      if (error instanceof RaftlineError && error.code === "RATE_LIMITED") {
        await delay(1200);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Raftline remained rate limited during the invariant test");
}

async function createCustomer(label: "alice" | "bob"): Promise<TestCustomer> {
  const short = `${stamp}${label === "alice" ? "1" : "2"}`;
  const id = `it_r2_${stamp}_${label}_${randomUUID().slice(0, 6)}`;
  const user = await prisma.user.create({
    data: {
      id,
      fullName: `Release Two ${label}`,
      email: `${id}@example.test`,
      phoneNumber: `+91${short}`,
      passwordHash: "integration-only-not-a-real-hash",
      username: `u${stamp}${label === "alice" ? "a" : "b"}${randomUUID().slice(0, 4)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: {
        create: {
          displayName: `Release Two ${label}`,
          preferredCurrency: "INR",
          preferredLanguage: "en-IN",
        },
      },
    },
  });

  const accountId = `np_it_${id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "release2-test" } });
  const wallet = await prisma.wallet.create({
    data: {
      userId: user.id,
      currency: "INR",
      walletType: "CUSTOMER",
      status: "ACTIVE",
      raftlineAccountId: accountId,
      provisionedAt: new Date(),
    },
  });

  const customer = {
    userId: user.id,
    accountId,
    walletId: wallet.id,
    username: user.username,
  };
  created.push(customer);
  return customer;
}

describe.skipIf(!enabled)("Release 2 financial invariants against live Raftline and PostgreSQL", () => {
  it(
    "funds once, settles once, and preserves the same durable intent for a repeated request",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");

      const fundingRequestId = randomUUID();
      const createdFunding = await fundingService.getOrCreateFundingOperation(alice.userId, {
        clientRequestId: fundingRequestId,
        amountMinor: 500_000,
      });
      const funding = await fundingService.executeFundingOperation(
        createdFunding.id,
        alice.userId,
      );
      expect(funding.status).toBe("COMPLETED");
      expect(funding.verification.receiptVerified).toBe(true);
      expect(funding.balanceAfterMinor).toBeGreaterThanOrEqual(500_000);
      expect(
        await prisma.fundingOperation.count({
          where: { userId: alice.userId, clientRequestId: fundingRequestId },
        }),
      ).toBe(1);

      const recipient = await recipientService.searchRecipient(alice.userId, bob.username);
      const requestId = randomUUID();
      const input = {
        clientRequestId: requestId,
        recipientToken: recipient.recipientToken,
        amountMinor: 50_000,
        description: "release2 invariant test",
      };

      const bobBefore = await client.getAccount(bob.accountId);
      expect(bobBefore).not.toBeNull();

      const intent = await paymentService.getOrCreatePaymentIntent(alice.userId, input);
      expect(intent.status).not.toBe("SETTLED");

      let result = await paymentService.executePaymentIntent(intent.id, alice.userId);
      for (let attempt = 0; attempt < 20 && result.status !== "SETTLED"; attempt += 1) {
        if (!result.failureMessage?.includes("busy")) break;
        await delay(1200);
        result = await paymentService.executePaymentIntent(intent.id, alice.userId);
      }
      expect(result.status, `failureMessage=${result.failureMessage ?? "none"}`).toBe("SETTLED");
      expect(result.paymentRef).toBeTruthy();
      expect(result.verification.receiptVerified).toBe(true);

      const sameRequest = await paymentService.getOrCreatePaymentIntent(alice.userId, input);
      expect(sameRequest.id).toBe(intent.id);
      expect(
        await prisma.paymentIntent.count({
          where: { userId: alice.userId, clientRequestId: requestId },
        }),
      ).toBe(1);

      const stored = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(stored.idempotencyKey).toMatch(/^np_pay_/);

      // A direct ledger replay with the same key must not move money twice.
      const replayReceipt = await settleWithRetry({
        idempotencyKey: stored.idempotencyKey,
        sourceAccountId: stored.sourceAccountId,
        destinationAccountId: stored.destinationAccountId,
        amountCents: 50_000,
        currency: "INR",
      });
      expect(replayReceipt.isIdempotentReplay).toBe(true);
      expect(
        verifySettlementReceipt(replayReceipt, {
          idempotencyKey: stored.idempotencyKey,
          amountMinor: 50_000,
          currency: "INR",
          sourceAccountId: stored.sourceAccountId,
          destinationAccountId: stored.destinationAccountId,
        }).type,
      ).toBe("SETTLED");

      const bobAfter = await client.getAccount(bob.accountId);
      expect(bobAfter!.balanceCents).toBe(bobBefore!.balanceCents + 50_000);
      expect(
        await prisma.transactionRecord.count({
          where: { userId: alice.userId, kind: "P2P", amountMinor: BigInt(50_000) },
        }),
      ).toBe(1);
    },
    120_000,
  );
});
