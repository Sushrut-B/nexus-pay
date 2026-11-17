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
let svc: {
  analytics: typeof import("../../apps/web/lib/finance/analytics-service");
  categories: typeof import("../../apps/web/lib/finance/category-service");
  budgets: typeof import("../../apps/web/lib/finance/budget-service");
  savings: typeof import("../../apps/web/lib/finance/savings-service");
  scheduled: typeof import("../../apps/web/lib/finance/scheduled-payment-service");
  engine: typeof import("../../apps/web/lib/finance/schedule-engine");
  recurring: typeof import("../../apps/web/lib/finance/recurring-service");
  statements: typeof import("../../apps/web/lib/finance/statement-service");
  funding: typeof import("../../apps/web/lib/payments/funding-service");
  payments: typeof import("../../apps/web/lib/payments/payment-service");
  recipients: typeof import("../../apps/web/lib/payments/recipient-service");
  notifications: typeof import("../../apps/web/lib/social/notification-service");
};

const created: Array<{ userId: string; accountId: string }> = [];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  ({ prisma } = await import("../../packages/database/src/index"));
  svc = {
    analytics: await import("../../apps/web/lib/finance/analytics-service"),
    categories: await import("../../apps/web/lib/finance/category-service"),
    budgets: await import("../../apps/web/lib/finance/budget-service"),
    savings: await import("../../apps/web/lib/finance/savings-service"),
    scheduled: await import("../../apps/web/lib/finance/scheduled-payment-service"),
    engine: await import("../../apps/web/lib/finance/schedule-engine"),
    recurring: await import("../../apps/web/lib/finance/recurring-service"),
    statements: await import("../../apps/web/lib/finance/statement-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    payments: await import("../../apps/web/lib/payments/payment-service"),
    recipients: await import("../../apps/web/lib/payments/recipient-service"),
    notifications: await import("../../apps/web/lib/social/notification-service"),
  };
  const config = loadRaftlineConfig(process.env as Record<string, string | undefined>);
  tenantId = config.tenantId;
  client = createRaftlineClient({ config });
});

afterAll(async () => {
  if (!enabled || !client || !prisma) return;
  const orphans = await prisma.user.findMany({ where: { email: { startsWith: "r4v_" } }, select: { id: true } }).catch(() => []);
  const ids = [...new Set([...created.map((c) => c.userId), ...orphans.map((u) => u.id)])];
  await prisma.budgetAlert.deleteMany({ where: { budget: { userId: { in: ids } } } }).catch(() => undefined);
  await prisma.budget.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.savingsContribution.deleteMany({ where: { goal: { userId: { in: ids } } } }).catch(() => undefined);
  await prisma.savingsGoal.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.scheduledPaymentExecution.deleteMany({ where: { scheduledPayment: { userId: { in: ids } } } }).catch(() => undefined);
  await prisma.scheduledPayment.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.recurringPaymentSuggestion.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.transactionCategorization.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.categorizationRule.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.statement.deleteMany({ where: { userId: { in: ids } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: "r4v_" } } }).catch(() => undefined);
  for (const item of created) {
    try {
      const summary = await client.getClusterSummary();
      if (summary.leader) {
        const key = encodeURIComponent(`pay:acc:${tenantId}:${item.accountId}`);
        await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
          method: "DELETE",
          headers: { "X-Client-Id": `nexuspay-r4v-cleanup-${randomUUID()}`, "X-Sequence-Number": "1" },
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
  const id = `r4v_${stamp}_${label}_${randomUUID().slice(0, 5)}`;
  const user = await prisma.user.create({
    data: {
      id,
      fullName: `Check ${label}`,
      email: `${id}@example.test`,
      phoneNumber: `+91${digits}`,
      passwordHash: "integration-only",
      username: `r4v${stamp.slice(-6)}${label.slice(0, 2)}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Check ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  const accountId = `np_r4v_${id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "release4-checklist" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  created.push({ userId: user.id, accountId });
  return { userId: user.id, username: user.username, accountId };
}

async function fund(userId: string, amountMinor: number) {
  const operation = await svc.funding.getOrCreateFundingOperation(userId, { clientRequestId: randomUUID(), amountMinor });
  if (operation.status !== "COMPLETED") await svc.funding.executeFundingOperation(operation.id, userId);
}

async function send(userId: string, recipientUsername: string, amountMinor: number, description: string) {
  const recipient = await svc.recipients.searchRecipient(userId, recipientUsername);
  const intent = await svc.payments.getOrCreatePaymentIntent(userId, {
    clientRequestId: randomUUID(),
    recipientToken: recipient.recipientToken,
    amountMinor,
    description,
  });
  let payment = await svc.payments.executePaymentIntent(intent.id, userId);
  for (let attempt = 0; attempt < 20 && payment.status !== "SETTLED"; attempt += 1) {
    if (payment.status !== "PROCESSING" && payment.status !== "UNKNOWN") break;
    await delay(1000);
    payment = await svc.payments.executePaymentIntent(intent.id, userId);
  }
  expect(payment.status).toBe("SETTLED");
  return payment;
}

async function expectApiError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected API error ${status}`);
  } catch (error) {
    expect((error as ApiError).status).toBe(status);
  }
}

describe.skipIf(!enabled)("Release 4 checklist verification", () => {
  it(
    "FIN-01: financial overview uses actual confirmed transactions",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await send(alice.userId, bob.username, 60_000, "Dinner with Bob");

      const overview = await svc.analytics.getFinanceOverview(alice.userId, "month");
      expect(overview.transactionCount).toBe(1);
      expect(overview.sentMinor).toBe(60_000);
      expect(overview.receivedMinor).toBe(0);
      expect(overview.generatedAt).toBeTruthy();

      const bobOverview = await svc.analytics.getFinanceOverview(bob.userId, "month");
      expect(bobOverview.receivedMinor).toBe(60_000);

      const unconfirmed = await prisma.transactionRecord.count({
        where: { userId: alice.userId, status: { not: "SUCCESSFUL" } },
      });
      expect(unconfirmed).toBe(0);
    },
    180_000,
  );

  it(
    "FIN-02: income and expenses are calculated without double-counting",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 300_000);
      await send(alice.userId, bob.username, 100_000, "Groceries at market");
      await send(alice.userId, bob.username, 50_000, "Shared dinner reimbursement");

      await svc.categories.ensureSystemCategories();
      const categories = await svc.categories.listCategories(alice.userId);
      const groceries = categories.find((c) => c.categoryType === "GROCERIES")!;
      const transfers = categories.find((c) => c.categoryType === "PERSONAL_TRANSFERS")!;
      const records = await prisma.transactionRecord.findMany({
        where: { userId: alice.userId, kind: "P2P", paymentRef: { not: null } },
        orderBy: { occurredAt: "asc" },
      });
      expect(records).toHaveLength(2);
      await svc.categories.categorizeTransaction(alice.userId, {
        paymentRef: records[0]!.paymentRef!,
        categoryId: groceries.id,
      });
      await svc.categories.categorizeTransaction(alice.userId, {
        paymentRef: records[1]!.paymentRef!,
        categoryId: transfers.id,
      });

      const overview = await svc.analytics.getFinanceOverview(alice.userId, "month");
      expect(overview.sentMinor).toBe(150_000);
      expect(overview.receivedMinor).toBe(0);
      // Funding is excluded from income; personal transfer is excluded from spending.
      expect(overview.expenseMinor).toBe(100_000);
      expect(overview.categoryBreakdown).toHaveLength(1);
      expect(overview.categoryBreakdown[0]?.categoryType).toBe("GROCERIES");

      // One transaction row per payment reference: no idempotent replay inflation.
      const refs = await prisma.transactionRecord.findMany({ where: { userId: alice.userId } });
      expect(new Set(refs.map((r) => r.paymentRef)).size).toBe(refs.length);
    },
    240_000,
  );

  it(
    "FIN-03: transaction categorization and personal rules work",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 100_000);
      const payment = await send(alice.userId, bob.username, 20_000, "Netflix monthly plan");

      await svc.categories.ensureSystemCategories();
      const categories = await svc.categories.listCategories(alice.userId);
      const subscriptions = categories.find((c) => c.categoryType === "SUBSCRIPTIONS")!;
      const food = categories.find((c) => c.categoryType === "FOOD_DINING")!;

      const high = await svc.categories.createRule(alice.userId, {
        conditionType: "CONTAINS", conditionValue: "Netflix", categoryId: food.id, priority: 50, isEnabled: true,
      });
      const low = await svc.categories.createRule(alice.userId, {
        conditionType: "CONTAINS", conditionValue: "Netflix", categoryId: subscriptions.id, priority: 100, isEnabled: true,
      });
      expect(low.priority).toBeGreaterThan(high.priority);
      expect(await svc.categories.resolveTransactionCategory(alice.userId, payment.paymentRef!, "Netflix monthly plan")).toBe(subscriptions.id);

      await svc.categories.categorizeTransaction(alice.userId, {
        paymentRef: payment.paymentRef!, categoryId: food.id, note: "Corrected manually",
      });
      expect(await svc.categories.resolveTransactionCategory(alice.userId, payment.paymentRef!, "Netflix monthly plan")).toBe(food.id);
      const record = await prisma.transactionRecord.findUniqueOrThrow({ where: { id: (
        await prisma.transactionRecord.findFirstOrThrow({ where: { paymentRef: payment.paymentRef! } })
      ).id } });
      expect(record.description).toBe("Netflix monthly plan");
    },
    180_000,
  );

  it(
    "FIN-04: spending analytics and period comparisons work",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await send(alice.userId, bob.username, 40_000, "Coffee and lunch");

      await svc.categories.ensureSystemCategories();
      const categories = await svc.categories.listCategories(alice.userId);
      const food = categories.find((c) => c.categoryType === "FOOD_DINING")!;
      const record = await prisma.transactionRecord.findFirstOrThrow({ where: { userId: alice.userId, kind: "P2P", paymentRef: { not: null } } });
      await svc.categories.categorizeTransaction(alice.userId, { paymentRef: record.paymentRef!, categoryId: food.id });

      const spending = await svc.analytics.getSpendingAnalytics(alice.userId, "month");
      expect(spending.totalSpentMinor).toBe(40_000);
      expect(spending.transactionCount).toBe(1);
      expect(spending.changePercentage).toBeNull(); // previous period is zero
      expect(spending.categories[0]?.categoryType).toBe("FOOD_DINING");

      const comparison = await svc.analytics.getSpendingAnalytics(alice.userId, "last_month");
      expect(comparison.totalSpentMinor).toBe(0);
      expect(comparison.changePercentage).toBeNull();
    },
    180_000,
  );

  it(
    "FIN-05: budgets calculate utilization and trigger alerts once",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await svc.categories.ensureSystemCategories();
      const categories = await svc.categories.listCategories(alice.userId);
      const food = categories.find((c) => c.categoryType === "FOOD_DINING")!;
      const start = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
      const budget = await svc.budgets.createBudget(alice.userId, {
        name: "Food", categoryId: food.id, amountMinor: 60_000, currency: "INR", periodType: "MONTHLY", startDate: start, thresholds: [50, 75, 90, 100],
      });
      for (const amount of [20_000, 20_000]) {
        const payment = await send(alice.userId, bob.username, amount, "Restaurant bill");
        await svc.categories.categorizeTransaction(alice.userId, { paymentRef: payment.paymentRef!, categoryId: food.id });
      }
      const first = await svc.budgets.listBudgets(alice.userId);
      const view = first.items.find((item) => item.id === budget.id)!;
      expect(view.spentMinor).toBe(40_000);
      expect(view.utilization).toBeCloseTo(66.7, 1);
      expect(view.remainingMinor).toBe(20_000);
      expect(view.crossedThresholds).toEqual([50]);
      const again = await svc.budgets.listBudgets(alice.userId);
      expect(again.items.find((item) => item.id === budget.id)!.crossedThresholds).toEqual([]);
      expect(await prisma.budgetAlert.count({ where: { budgetId: budget.id } })).toBe(1);
      const alerts = await svc.notifications.listNotifications(alice.userId, { page: 1, pageSize: 50 });
      expect(alerts.items.filter((n) => n.title === "Budget 50% reached")).toHaveLength(1);
    },
    240_000,
  );

  it(
    "FIN-06: savings goals distinguish planned contributions from actual money",
    async () => {
      const alice = await createCustomer("alice");
      const goal = await svc.savings.createGoal(alice.userId, { name: "Emergency fund", targetAmountMinor: 50_000, currency: "INR" });
      const planned = await svc.savings.addContribution(alice.userId, goal.id, { amountMinor: 30_000, contributionType: "PLANNED" });
      expect(planned.recordedMinor).toBe(0);
      expect(planned.plannedMinor).toBe(30_000);
      expect(planned.progress).toBe(0);
      expect(planned.status).toBe("ACTIVE");

      const recorded = await svc.savings.addContribution(alice.userId, goal.id, { amountMinor: 50_000, contributionType: "RECORDED" });
      expect(recorded.recordedMinor).toBe(50_000);
      expect(recorded.progress).toBe(100);
      expect(recorded.status).toBe("COMPLETED");

      const wallet = await client.getAccount(created.find((c) => c.userId === alice.userId)!.accountId);
      expect(wallet!.balanceCents).toBe(0); // goal contributions never moved wallet money

      await expectApiError(svc.savings.addContribution(alice.userId, goal.id, { amountMinor: 1_000, contributionType: "RECORDED" }), 409);
    },
    120_000,
  );

  it(
    "FIN-07: scheduled payments support pause, resume and cancellation",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
      const schedule = await svc.scheduled.createScheduledPayment(alice.userId, {
        recipientQuery: bob.username, amountMinor: 10_000, currency: "INR", frequency: "MONTHLY", startDate: future,
      });
      expect(schedule.status).toBe("ACTIVE");
      expect((await svc.scheduled.pauseScheduledPayment(alice.userId, schedule.id)).status).toBe("PAUSED");
      expect((await svc.scheduled.resumeScheduledPayment(alice.userId, schedule.id)).status).toBe("ACTIVE");
      expect((await svc.scheduled.cancelScheduledPayment(alice.userId, schedule.id)).status).toBe("CANCELLED");
      await expectApiError(svc.scheduled.pauseScheduledPayment(alice.userId, schedule.id), 409);
    },
    120_000,
  );

  it(
    "FIN-08: background workers prevent duplicate executions",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      const schedule = await svc.scheduled.createScheduledPayment(alice.userId, {
        recipientQuery: bob.username, amountMinor: 10_000, currency: "INR", frequency: "MONTHLY",
        startDate: new Date(Date.now() - 60_000).toISOString(),
      });
      const first = await svc.engine.runDueExecutions(50);
      expect(first.settled).toBeGreaterThanOrEqual(1);
      const second = await svc.engine.runDueExecutions(50);
      expect(second.settled).toBe(0);
      const executions = await svc.scheduled.listExecutions(alice.userId, schedule.id);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe("SETTLED");
    },
    240_000,
  );

  it(
    "FIN-09: scheduled payments use the existing Raftline-backed engine",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      const aliceBefore = await client.getAccount(alice.accountId);
      const bobBefore = await client.getAccount(bob.accountId);
      const schedule = await svc.scheduled.createScheduledPayment(alice.userId, {
        recipientQuery: bob.username, amountMinor: 15_000, currency: "INR", frequency: "MONTHLY",
        startDate: new Date(Date.now() - 60_000).toISOString(),
      });
      await svc.engine.runDueExecutions(50);
      const aliceAfter = await client.getAccount(alice.accountId);
      const bobAfter = await client.getAccount(bob.accountId);
      expect(aliceBefore!.balanceCents - aliceAfter!.balanceCents).toBe(15_000);
      expect(bobAfter!.balanceCents - bobBefore!.balanceCents).toBe(15_000);

      const executions = await svc.scheduled.listExecutions(alice.userId, schedule.id);
      expect(executions[0]!.paymentRef).toBeTruthy();
      const receipt = await client.getTransaction(executions[0]!.paymentRef!);
      expect(receipt?.status.toUpperCase()).toBe("SETTLED");
    },
    240_000,
  );

  it(
    "FIN-10: recurring suggestions are not treated as active mandates",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await send(alice.userId, bob.username, 30_000, "Weekly allowance");
      await send(alice.userId, bob.username, 30_000, "Weekly allowance");
      const suggestions = await svc.recurring.detectRecurringSuggestions(alice.userId);
      const suggestion = suggestions.find((item) => item.amountMinor === 30_000)!;
      expect(suggestion.status).toBe("SUGGESTED");
      expect(suggestion.explanation.toLowerCase()).toContain("paid");
      expect(await svc.scheduled.listScheduledPayments(alice.userId)).toHaveLength(0);
      await svc.recurring.ignoreSuggestion(alice.userId, suggestion.id);
      expect((await svc.recurring.detectRecurringSuggestions(alice.userId)).find((s) => s.id === suggestion.id)!.status).toBe("IGNORED");
    },
    240_000,
  );

  it(
    "FIN-11: PDF and CSV statements contain accurate transaction records",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 100_000);
      const payment = await send(alice.userId, bob.username, 25_000, "Statement line item");
      const now = new Date();
      const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const periodEnd = now.toISOString().slice(0, 10);
      const pdf = await svc.statements.generateStatement(alice.userId, { format: "PDF", periodStart, periodEnd });
      const csv = await svc.statements.generateStatement(alice.userId, { format: "CSV", periodStart, periodEnd });
      expect(pdf.totals.outflowMinor).toBe(25_000);
      expect(csv.totals.transactionCount).toBe(1);
      const pdfFile = await svc.statements.downloadStatement(alice.userId, pdf.id);
      expect(pdfFile.buffer[0]).toBe(0x25);
      const csvFile = await svc.statements.downloadStatement(alice.userId, csv.id);
      expect(csvFile.buffer.toString("utf8")).toContain("Statement line item");
      expect(csvFile.buffer.toString("utf8")).toContain(payment.paymentRef!);
      await expectApiError(svc.statements.downloadStatement(bob.userId, pdf.id), 404);
    },
    180_000,
  );
});
