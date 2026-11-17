import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRaftlineClient,
  loadRaftlineConfig,
  type RaftlinePaymentsClient,
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
let activity: typeof import("../../apps/web/lib/social/activity-service");
let funding: typeof import("../../apps/web/lib/payments/funding-service");

const created: Array<{ userId: string; accountId: string }> = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  ({ prisma } = await import("../../packages/database/src/index"));
  contacts = await import("../../apps/web/lib/social/contact-service");
  requests = await import("../../apps/web/lib/social/request-service");
  groups = await import("../../apps/web/lib/social/group-service");
  expenses = await import("../../apps/web/lib/social/expense-service");
  balances = await import("../../apps/web/lib/social/group-balance-service");
  settlements = await import("../../apps/web/lib/social/settlement-service");
  notifications = await import("../../apps/web/lib/social/notification-service");
  activity = await import("../../apps/web/lib/social/activity-service");
  funding = await import("../../apps/web/lib/payments/funding-service");

  const config = loadRaftlineConfig(process.env as Record<string, string | undefined>);
  tenantId = config.tenantId;
  client = createRaftlineClient({ config });
});

afterAll(async () => {
  if (!enabled || !client || !prisma) return;
  const orphanUsers = await prisma.user
    .findMany({ where: { email: { startsWith: "r3v_" } }, select: { id: true } })
    .catch(() => []);
  const ids = [...new Set([...created.map((item) => item.userId), ...orphanUsers.map((u) => u.id)])];
  await prisma.groupSettlement.deleteMany({ where: { payerUserId: { in: ids } } }).catch(() => undefined);
  await prisma.groupActivity.deleteMany({ where: { actorUserId: { in: ids } } }).catch(() => undefined);
  await prisma.expenseSplit.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.expense.deleteMany({ where: { paidByUserId: { in: ids } } }).catch(() => undefined);
  await prisma.groupMember.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.expenseGroup.deleteMany({ where: { createdBy: { in: ids } } }).catch(() => undefined);
  await prisma.paymentRequest.deleteMany({ where: { requesterUserId: { in: ids } } }).catch(() => undefined);
  await prisma.contact.deleteMany({ where: { ownerUserId: { in: ids } } }).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: "r3v_" } } }).catch(() => undefined);
  for (const item of created) {
    await prisma.user.deleteMany({ where: { id: item.userId } }).catch(() => undefined);
    try {
      const summary = await client.getClusterSummary();
      if (summary.leader) {
        const key = encodeURIComponent(`pay:acc:${tenantId}:${item.accountId}`);
        await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
          method: "DELETE",
          headers: { "X-Client-Id": `nexuspay-r3v-cleanup-${randomUUID()}`, "X-Sequence-Number": "1" },
        });
      }
    } catch {
      // best effort
    }
  }
  await prisma.$disconnect().catch(() => undefined);
});

async function createCustomer(label: string) {
  const digits = randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10);
  const id = `r3v_${stamp}_${label}_${randomUUID().slice(0, 5)}`;
  const user = await prisma.user.create({
    data: {
      id,
      fullName: `Verify ${label}`,
      email: `${id}@example.test`,
      phoneNumber: `+91${digits}`,
      passwordHash: "integration-only",
      username: `r3v${stamp.slice(-6)}${label.slice(0, 2)}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: {
        create: { displayName: `Verify ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" },
      },
    },
  });
  const accountId = `np_r3v_${id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "release3-verify" } });
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
    throw new Error(`Expected API error ${status}`);
  } catch (error) {
    expect((error as ApiError).status).toBe(status);
  }
}

async function settleWithRetry(settlementId: string, userId: string) {
  let result = await settlements.executeSettlement(userId, settlementId);
  for (let attempt = 0; attempt < 20 && result.status !== "SETTLED"; attempt += 1) {
    await delay(1000);
    result = await settlements.executeSettlement(userId, settlementId);
  }
  return result;
}

describe.skipIf(!enabled)("Release 3 checklist verification", () => {
  it(
    "contacts: secure search, add, duplicate/self prevention, ownership",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const outsider = await createCustomer("diana");

      const contact = await contacts.addContact(alice.userId, { query: bob.username });
      expect(contact.user.username).toBe(bob.username);
      expect(contact.user.userId).toBe(bob.userId);
      // No ledger identifiers leak through the contact contract.
      expect(JSON.stringify(contact)).not.toContain("np_");
      expect(JSON.stringify(contact)).not.toContain(bob.accountId);

      await expectApiError(contacts.addContact(alice.userId, { query: bob.username }), 409);
      await expectApiError(contacts.addContact(alice.userId, { query: alice.username }), 400);
      await expectApiError(contacts.getContact(outsider.userId, contact.id), 404);
      await expectApiError(contacts.removeContact(outsider.userId, contact.id), 404);

      await contacts.removeContact(alice.userId, contact.id);
      expect((await contacts.listContacts(alice.userId)).total).toBe(0);
    },
    60_000,
  );

  it(
    "payment requests: create, accept, decline, cancel, pay and verified association",
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
      await expectApiError(requests.declineRequest(outsider.userId, request.id), 404);

      const accepted = await requests.acceptRequest(bob.userId, request.id);
      expect(accepted.status).toBe("ACCEPTED");
      expect(accepted.canPay).toBe(true);

      const payResult = await requests.payRequest(bob.userId, request.id);
      expect(payResult.request.status).toBe("PAID");
      expect(payResult.request.paymentRef).toBeTruthy();
      expect(payResult.paymentStatus).toBe("SETTLED");
      await expectApiError(requests.payRequest(bob.userId, request.id), 409);

      // Decline and cancel paths on their own requests.
      const declined = await requests.createRequest(alice.userId, {
        payerQuery: bob.username,
        amountMinor: 10_000,
        currency: "INR",
      });
      expect((await requests.declineRequest(bob.userId, declined.id)).status).toBe("DECLINED");

      const cancelled = await requests.createRequest(alice.userId, {
        payerQuery: bob.username,
        amountMinor: 10_000,
        currency: "INR",
      });
      expect((await requests.cancelRequest(alice.userId, cancelled.id)).status).toBe("CANCELLED");
    },
    180_000,
  );

  it(
    "groups: creation, membership, duplicates and authorization",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const outsider = await createCustomer("diana");

      const group = await groups.createGroup(alice.userId, {
        name: "Verify Trip",
        category: "TRAVEL",
        memberQueries: [bob.username],
      });
      expect(group.memberCount).toBe(2);
      expect(group.role).toBe("ADMIN");

      const duplicate = await groups.addGroupMember(alice.userId, group.id, { query: bob.username });
      expect(duplicate.userId).toBe(bob.userId);
      expect((await groups.getGroupDetail(alice.userId, group.id)).members.filter((m) => !m.removedAt).length).toBe(2);

      await expectApiError(groups.addGroupMember(bob.userId, group.id, { query: outsider.username }), 403);
      await expectApiError(groups.getGroupDetail(outsider.userId, group.id), 403);
      await expectApiError(groups.updateGroup(bob.userId, group.id, { name: "Hacked" }), 403);

      await groups.addGroupMember(alice.userId, group.id, { query: outsider.username });
      await groups.removeGroupMember(alice.userId, group.id, outsider.userId);
      expect((await groups.getGroupDetail(alice.userId, group.id)).members.filter((m) => !m.removedAt).length).toBe(2);
    },
    90_000,
  );

  it(
    "splits: equal, custom, percentage and shares are exact",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const charlie = await createCustomer("charlie");
      const diana = await createCustomer("diana");

      const group = await groups.createGroup(alice.userId, {
        name: "Split Lab",
        category: "OTHER",
        memberQueries: [bob.username, charlie.username, diana.username],
      });

      const equal = await expenses.createExpense(alice.userId, group.id, {
        title: "Equal",
        totalAmountMinor: 10_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
          { userId: charlie.userId },
        ],
      });
      expect(equal.splits.map((s) => s.shareAmountMinor).sort((a, b) => a - b)).toEqual([3333, 3333, 3334]);
      expect(equal.splits.reduce((sum, s) => sum + s.shareAmountMinor, 0)).toBe(10_000);

      const custom = await expenses.createExpense(alice.userId, group.id, {
        title: "Custom",
        totalAmountMinor: 20_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "CUSTOM",
        participants: [
          { userId: alice.userId, amountMinor: 5_000 },
          { userId: bob.userId, amountMinor: 5_000 },
          { userId: charlie.userId, amountMinor: 7_000 },
          { userId: diana.userId, amountMinor: 3_000 },
        ],
      });
      expect(custom.splits.reduce((sum, s) => sum + s.shareAmountMinor, 0)).toBe(20_000);

      const percentage = await expenses.createExpense(alice.userId, group.id, {
        title: "Percentage",
        totalAmountMinor: 10_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "PERCENTAGE",
        participants: [
          { userId: alice.userId, percentage: 50 },
          { userId: bob.userId, percentage: 30 },
          { userId: charlie.userId, percentage: 20 },
        ],
      });
      const pctShares = Object.fromEntries(percentage.splits.map((s) => [s.userId, s.shareAmountMinor]));
      expect(pctShares[alice.userId]).toBe(5_000);
      expect(pctShares[bob.userId]).toBe(3_000);
      expect(pctShares[charlie.userId]).toBe(2_000);

      const shares = await expenses.createExpense(alice.userId, group.id, {
        title: "Shares",
        totalAmountMinor: 10_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "SHARES",
        participants: [
          { userId: alice.userId, shares: 2 },
          { userId: bob.userId, shares: 1 },
          { userId: charlie.userId, shares: 1 },
        ],
      });
      const shareValues = Object.fromEntries(shares.splits.map((s) => [s.userId, s.shareAmountMinor]));
      expect(shareValues[alice.userId]).toBe(5_000);
      expect(shareValues[bob.userId]).toBe(2_500);
      expect(shareValues[charlie.userId]).toBe(2_500);

      await expectApiError(
        expenses.createExpense(alice.userId, group.id, {
          title: "Bad",
          totalAmountMinor: 10_000,
          category: "FOOD",
          expenseDate: "2026-11-17",
          paidByUserId: alice.userId,
          splitMethod: "CUSTOM",
          participants: [
            { userId: alice.userId, amountMinor: 5_000 },
            { userId: bob.userId, amountMinor: 6_000 },
          ],
        }),
        400,
      );
    },
    120_000,
  );

  it(
    "balances and suggestions: net zero and deterministic debt simplification",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const charlie = await createCustomer("charlie");

      const group = await groups.createGroup(alice.userId, {
        name: "Balance Lab",
        category: "OTHER",
        memberQueries: [bob.username, charlie.username],
      });

      await expenses.createExpense(alice.userId, group.id, {
        title: "Dinner",
        totalAmountMinor: 150_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
          { userId: charlie.userId },
        ],
      });

      const result = await balances.getGroupBalances(group.id);
      expect(result.sumMinor).toBe(0);
      expect(result.consistent).toBe(true);
      expect(result.entries.find((e) => e.user.userId === alice.userId)?.netMinor).toBe(100_000);
      expect(result.entries.find((e) => e.user.userId === bob.userId)?.netMinor).toBe(-50_000);
      expect(result.entries.find((e) => e.user.userId === charlie.userId)?.netMinor).toBe(-50_000);

      const suggestions = await balances.getSuggestedSettlements(group.id);
      expect(suggestions).toEqual([
        { payer: expect.objectContaining({ userId: bob.userId }), payee: expect.objectContaining({ userId: alice.userId }), amountMinor: 50_000 },
        { payer: expect.objectContaining({ userId: charlie.userId }), payee: expect.objectContaining({ userId: alice.userId }), amountMinor: 50_000 },
      ]);
      expect(suggestions.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(100_000);
    },
    120_000,
  );

  it(
    "settlements: real engine, partial dues, duplicate safety",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const charlie = await createCustomer("charlie");
      await fund(bob.userId, 100_000);

      const group = await groups.createGroup(alice.userId, {
        name: "Settle Lab",
        category: "OTHER",
        memberQueries: [bob.username, charlie.username],
      });
      await expenses.createExpense(alice.userId, group.id, {
        title: "Dinner",
        totalAmountMinor: 150_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
          { userId: charlie.userId },
        ],
      });

      const before = await client.getAccount(bob.accountId);
      const clientRequestId = randomUUID();
      const settlement = await settlements.createSettlement(bob.userId, group.id, {
        payeeUserId: alice.userId,
        amountMinor: 20_000,
        clientRequestId,
      });
      const settled = await settleWithRetry(settlement.id, bob.userId);
      expect(settled.status).toBe("SETTLED");
      expect(settled.paymentRef).toBeTruthy();

      const after = await client.getAccount(bob.accountId);
      expect(after!.balanceCents).toBe(before!.balanceCents - 20_000);

      const partial = await balances.getGroupBalances(group.id);
      expect(partial.entries.find((e) => e.user.userId === bob.userId)?.netMinor).toBe(-30_000);
      expect(partial.entries.find((e) => e.user.userId === alice.userId)?.netMinor).toBe(80_000);

      const duplicate = await settlements.createSettlement(bob.userId, group.id, {
        payeeUserId: alice.userId,
        amountMinor: 20_000,
        clientRequestId,
      });
      expect(duplicate.id).toBe(settlement.id);
      const replay = await settleWithRetry(duplicate.id, bob.userId);
      expect(replay.status).toBe("SETTLED");
      const afterReplay = await balances.getGroupBalances(group.id);
      expect(afterReplay.entries.find((e) => e.user.userId === bob.userId)?.netMinor).toBe(-30_000);

      await expectApiError(
        settlements.createSettlement(bob.userId, group.id, {
          payeeUserId: alice.userId,
          amountMinor: 999_999,
          clientRequestId: randomUUID(),
        }),
        409,
      );
    },
    240_000,
  );

  it(
    "notifications and activity reflect real events",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(bob.userId, 100_000);

      const request = await requests.createRequest(alice.userId, {
        payerQuery: bob.username,
        amountMinor: 10_000,
        currency: "INR",
      });
      const group = await groups.createGroup(alice.userId, {
        name: "Activity Lab",
        category: "OTHER",
        memberQueries: [bob.username],
      });
      await expenses.createExpense(alice.userId, group.id, {
        title: "Activity expense",
        totalAmountMinor: 6_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
        ],
      });
      await requests.payRequest(bob.userId, request.id);

      const bobNotifications = await notifications.listNotifications(bob.userId, { page: 1, pageSize: 50 });
      expect(bobNotifications.items.some((item) => item.type === "PAYMENT_REQUEST_RECEIVED")).toBe(true);
      expect(bobNotifications.items.some((item) => item.type === "ADDED_TO_GROUP")).toBe(true);
      expect(bobNotifications.items.some((item) => item.type === "GROUP_EXPENSE_CREATED")).toBe(true);

      const aliceNotifications = await notifications.listNotifications(alice.userId, { page: 1, pageSize: 50 });
      expect(aliceNotifications.items.some((item) => item.type === "PAYMENT_REQUEST_PAID")).toBe(true);

      const events = await activity.listGroupActivity(alice.userId, group.id);
      expect(events.items.some((item) => item.eventType === "GROUP_CREATED")).toBe(true);
      expect(events.items.some((item) => item.eventType === "MEMBER_JOINED")).toBe(true);
      expect(events.items.some((item) => item.eventType === "EXPENSE_CREATED")).toBe(true);
    },
    180_000,
  );

  it(
    "authorization: cross-user isolation for groups, expenses, requests and settlements",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const outsider = await createCustomer("diana");

      const group = await groups.createGroup(alice.userId, {
        name: "Private Group",
        category: "FAMILY",
        memberQueries: [bob.username],
      });
      const expense = await expenses.createExpense(alice.userId, group.id, {
        title: "Private expense",
        totalAmountMinor: 10_000,
        category: "FOOD",
        expenseDate: "2026-11-17",
        paidByUserId: alice.userId,
        splitMethod: "EQUAL",
        participants: [
          { userId: alice.userId },
          { userId: bob.userId },
        ],
      });
      const request = await requests.createRequest(alice.userId, {
        payerQuery: bob.username,
        amountMinor: 10_000,
        currency: "INR",
      });

      await expectApiError(groups.getGroupDetail(outsider.userId, group.id), 403);
      await expectApiError(expenses.getExpense(outsider.userId, group.id, expense.id), 403);
      await expectApiError(expenses.listExpenses(outsider.userId, group.id), 403);
      await expectApiError(requests.getRequest(outsider.userId, request.id), 404);
      await expectApiError(requests.acceptRequest(outsider.userId, request.id), 404);
      await expectApiError(balances.getGroupBalancesFor(outsider.userId, group.id), 403);
      await expectApiError(activity.listGroupActivity(outsider.userId, group.id), 403);
      await expectApiError(
        settlements.listSettlements(outsider.userId, group.id),
        403,
      );
    },
    90_000,
  );
});
