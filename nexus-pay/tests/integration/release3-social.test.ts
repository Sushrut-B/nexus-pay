import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RaftlineError,
  createRaftlineClient,
  loadRaftlineConfig,
  type RaftlinePaymentsClient,
  type SettlePaymentInput,
} from "../../packages/api-client/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);

let prisma: typeof import("../../packages/database/src/index")["prisma"];
let client: RaftlinePaymentsClient;
let tenantId: string;
let contacts: typeof import("../../apps/web/lib/social/contact-service");
let requests: typeof import("../../apps/web/lib/social/request-service");
let groups: typeof import("../../apps/web/lib/social/group-service");
let expenses: typeof import("../../apps/web/lib/social/expense-service");
let balances: typeof import("../../apps/web/lib/social/group-balance-service");
let settlements: typeof import("../../apps/web/lib/social/settlement-service");
let notifications: typeof import("../../apps/web/lib/social/notification-service");
let funding: typeof import("../../apps/web/lib/payments/funding-service");

const created: Array<{ userId: string; accountId: string }> = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  throw new Error("Raftline remained rate limited");
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  const apiClient = { createRaftlineClient, loadRaftlineConfig };
  ({ prisma } = await import("../../packages/database/src/index"));
  contacts = await import("../../apps/web/lib/social/contact-service");
  requests = await import("../../apps/web/lib/social/request-service");
  groups = await import("../../apps/web/lib/social/group-service");
  expenses = await import("../../apps/web/lib/social/expense-service");
  balances = await import("../../apps/web/lib/social/group-balance-service");
  settlements = await import("../../apps/web/lib/social/settlement-service");
  notifications = await import("../../apps/web/lib/social/notification-service");
  funding = await import("../../apps/web/lib/payments/funding-service");

  const config = loadRaftlineConfig(process.env as Record<string, string | undefined>);
  tenantId = config.tenantId;
  client = createRaftlineClient({ config });
});

afterAll(async () => {
  if (!enabled || !client || !prisma) return;
  const orphanUsers = await prisma.user
    .findMany({ where: { email: { startsWith: "r3_" } }, select: { id: true } })
    .catch(() => []);
  const ids = [...new Set([...created.map((item) => item.userId), ...orphanUsers.map((user) => user.id)])];
  await prisma.groupSettlement.deleteMany({ where: { payerUserId: { in: ids } } }).catch(() => undefined);
  await prisma.groupActivity.deleteMany({ where: { actorUserId: { in: ids } } }).catch(() => undefined);
  await prisma.expenseSplit.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.expense.deleteMany({ where: { paidByUserId: { in: ids } } }).catch(() => undefined);
  await prisma.groupMember.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.expenseGroup.deleteMany({ where: { createdBy: { in: ids } } }).catch(() => undefined);
  await prisma.paymentRequest.deleteMany({ where: { requesterUserId: { in: ids } } }).catch(() => undefined);
  await prisma.contact.deleteMany({ where: { ownerUserId: { in: ids } } }).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: "r3_" } } }).catch(() => undefined);
  for (const item of created) {
    await prisma.user.deleteMany({ where: { id: item.userId } }).catch(() => undefined);
    try {
      const summary = await client.getClusterSummary();
      if (summary.leader) {
        const key = encodeURIComponent(`pay:acc:${tenantId}:${item.accountId}`);
        await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
          method: "DELETE",
          headers: {
            "X-Client-Id": `nexuspay-r3-cleanup-${randomUUID()}`,
            "X-Sequence-Number": "1",
          },
        });
      }
    } catch {
      // best effort
    }
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function createCustomer(label: "alice" | "bob" | "charlie" | "diana") {
  const short = randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const id = `r3_${stamp}_${label}_${randomUUID().slice(0, 5)}`;
  const user = await prisma.user.create({
    data: {
      id,
      fullName: `Release Three ${label}`,
      email: `${id}@example.test`,
      phoneNumber: `+91${short}`,
      passwordHash: "integration-only",
      username: `r3${stamp.slice(-6)}${label.slice(0, 2)}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: {
        create: {
          displayName: `Release Three ${label}`,
          preferredCurrency: "INR",
          preferredLanguage: "en-IN",
        },
      },
    },
  });
  const accountId = `np_r3_${id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "release3-test" } });
  await prisma.wallet.create({
    data: {
      userId: user.id,
      currency: "INR",
      walletType: "CUSTOMER",
      status: "ACTIVE",
      raftlineAccountId: accountId,
      provisionedAt: new Date(),
    },
  });
  created.push({ userId: user.id, accountId });
  return { userId: user.id, username: user.username, accountId };
}

async function fund(userId: string, amountMinor: number) {
  const createdFunding = await funding.getOrCreateFundingOperation(userId, {
    clientRequestId: randomUUID(),
    amountMinor,
  });
  if (createdFunding.status === "COMPLETED") return;
  await funding.executeFundingOperation(createdFunding.id, userId);
}

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected an API error with status ${status}`);
  } catch (error) {
    const apiError = error as ApiError;
    expect(apiError.status).toBe(status);
  }
}

describe.skipIf(!enabled)("Release 3 social features against live services", () => {
  it(
    "manages contacts with ownership, duplicate and self checks",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const outsider = await createCustomer("diana");

      const contact = await contacts.addContact(alice.userId, { query: bob.username });
      expect(contact.user.username).toBe(bob.username);
      expect((await contacts.listContacts(alice.userId)).total).toBe(1);

      await expectApiError(
        contacts.addContact(alice.userId, { query: bob.username }),
        409,
      );
      await expectApiError(contacts.addContact(alice.userId, { query: alice.username }), 400);
      await expectApiError(contacts.getContact(outsider.userId, contact.id), 404);
      await expectApiError(contacts.removeContact(outsider.userId, contact.id), 404);

      await contacts.removeContact(alice.userId, contact.id);
      expect((await contacts.listContacts(alice.userId)).total).toBe(0);
    },
    60_000,
  );

  it(
    "runs a payment request through accept and a verified real payment",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const outsider = await createCustomer("diana");
      await fund(bob.userId, 100_000);

      const request = await requests.createRequest(alice.userId, {
        payerQuery: bob.username,
        amountMinor: 50_000,
        currency: "INR",
        description: "Shared cab",
      });
      expect(request.status).toBe("PENDING");
      expect(request.canPay).toBe(false);

      await expectApiError(requests.acceptRequest(outsider.userId, request.id), 404);
      const accepted = await requests.acceptRequest(bob.userId, request.id);
      expect(accepted.status).toBe("ACCEPTED");

      let result = await requests.payRequest(bob.userId, request.id);
      for (let attempt = 0; attempt < 20 && result.paymentStatus !== "SETTLED"; attempt += 1) {
        if (result.paymentStatus !== "PROCESSING" && result.paymentStatus !== "UNKNOWN") break;
        await delay(1200);
        result = await requests.payRequest(bob.userId, request.id);
      }
      expect(result.paymentStatus).toBe("SETTLED");
      expect(result.request.status).toBe("PAID");
      expect(result.request.paymentRef).toBeTruthy();
      await expectApiError(requests.payRequest(bob.userId, request.id), 409);

      const summary = await requests.getRequestSummary(alice.userId);
      expect(summary.sentPendingCount).toBe(0);
      const aliceNotifications = await notifications.listNotifications(alice.userId, { page: 1, pageSize: 20 });
      expect(aliceNotifications.items.some((item) => item.type === "PAYMENT_REQUEST_PAID")).toBe(true);
    },
    180_000,
  );

  it(
    "calculates balances, supports partial settlement and prevents duplicate debits",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const charlie = await createCustomer("charlie");
      await fund(bob.userId, 100_000);

      const group = await groups.createGroup(alice.userId, {
        name: "Goa Trip",
        category: "TRAVEL",
        memberQueries: [bob.username, charlie.username],
      });
      expect(group.memberCount).toBe(3);
      expect(group.role).toBe("ADMIN");
      await expectApiError(
        groups.addGroupMember(bob.userId, group.id, { query: charlie.username }),
        403,
      );

      const expense = await expenses.createExpense(alice.userId, group.id, {
        title: "Dinner",
        totalAmountMinor: 150_000,
        category: "FOOD",
        expenseDate: new Date().toISOString().slice(0, 10),
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
          { userId: charlie.userId },
        ],
      });
      expect(expense.splits.reduce((sum, split) => sum + split.shareAmountMinor, 0)).toBe(150_000);

      const before = await balances.getGroupBalances(group.id);
      expect(before.sumMinor).toBe(0);
      expect(before.entries.find((entry) => entry.user.userId === alice.userId)?.netMinor).toBe(100_000);
      expect(before.entries.find((entry) => entry.user.userId === bob.userId)?.netMinor).toBe(-50_000);

      const clientRequestId = randomUUID();
      const partial = await settlements.createSettlement(bob.userId, group.id, {
        payeeUserId: alice.userId,
        amountMinor: 20_000,
        clientRequestId,
      });
      let settled = await settlements.executeSettlement(bob.userId, partial.id);
      for (let attempt = 0; attempt < 20 && settled.status !== "SETTLED"; attempt += 1) {
        await delay(1200);
        settled = await settlements.executeSettlement(bob.userId, partial.id);
      }
      expect(settled.status).toBe("SETTLED");
      expect(settled.paymentRef).toBeTruthy();

      const after = await balances.getGroupBalances(group.id);
      expect(after.entries.find((entry) => entry.user.userId === bob.userId)?.netMinor).toBe(-30_000);
      expect(after.entries.find((entry) => entry.user.userId === alice.userId)?.netMinor).toBe(80_000);

      const duplicate = await settlements.createSettlement(bob.userId, group.id, {
        payeeUserId: alice.userId,
        amountMinor: 20_000,
        clientRequestId,
      });
      expect(duplicate.id).toBe(partial.id);
      const replay = await settlements.executeSettlement(bob.userId, duplicate.id);
      expect(replay.status).toBe("SETTLED");
      const afterReplay = await balances.getGroupBalances(group.id);
      expect(afterReplay.entries.find((entry) => entry.user.userId === bob.userId)?.netMinor).toBe(-30_000);

      await expectApiError(
        settlements.createSettlement(bob.userId, group.id, {
          payeeUserId: alice.userId,
          amountMinor: 999_999,
          clientRequestId: randomUUID(),
        }),
        409,
      );
      await expectApiError(
        expenses.deleteExpense(alice.userId, group.id, expense.id),
        409,
      );
    },
    240_000,
  );
});
