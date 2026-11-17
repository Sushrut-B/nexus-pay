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
let finance: {
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
};

const created: Array<{ userId: string; accountId: string }> = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  ({ prisma } = await import("../../packages/database/src/index"));
  finance = {
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
  };
  const config = loadRaftlineConfig(process.env as Record<string, string | undefined>);
  tenantId = config.tenantId;
  client = createRaftlineClient({ config });
});

afterAll(async () => {
  if (!enabled || !client || !prisma) return;
  const orphans = await prisma.user
    .findMany({ where: { email: { startsWith: "r4_" } }, select: { id: true } })
    .catch(() => []);
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
  await prisma.user.deleteMany({ where: { email: { startsWith: "r4_" } } }).catch(() => undefined);
  for (const item of created) {
    try {
      const summary = await client.getClusterSummary();
      if (summary.leader) {
        const key = encodeURIComponent(`pay:acc:${tenantId}:${item.accountId}`);
        await fetch(`${summary.leader.baseUrl}/v1/kv/${key}`, {
          method: "DELETE",
          headers: { "X-Client-Id": `nexuspay-r4-cleanup-${randomUUID()}`, "X-Sequence-Number": "1" },
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
  const id = `r4_${stamp}_${label}_${randomUUID().slice(0, 5)}`;
  const user = await prisma.user.create({
    data: {
      id,
      fullName: `Finance ${label}`,
      email: `${id}@example.test`,
      phoneNumber: `+91${digits}`,
      passwordHash: "integration-only",
      username: `r4${stamp.slice(-6)}${label.slice(0, 2)}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Finance ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  const accountId = `np_r4_${id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await client.ensureAccount({ accountId, currency: "INR", metadata: { source: "release4-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  created.push({ userId: user.id, accountId });
  return { userId: user.id, username: user.username, accountId };
}

async function fund(userId: string, amountMinor: number) {
  const operation = await finance.funding.getOrCreateFundingOperation(userId, {
    clientRequestId: randomUUID(),
    amountMinor,
  });
  if (operation.status !== "COMPLETED") {
    await finance.funding.executeFundingOperation(operation.id, userId);
  }
}

async function send(userId: string, recipientUsername: string, amountMinor: number, description: string) {
  const recipient = await finance.recipients.searchRecipient(userId, recipientUsername);
  const intent = await finance.payments.getOrCreatePaymentIntent(userId, {
    clientRequestId: randomUUID(),
    recipientToken: recipient.recipientToken,
    amountMinor,
    description,
  });
  let payment = await finance.payments.executePaymentIntent(intent.id, userId);
  for (let attempt = 0; attempt < 20 && payment.status !== "SETTLED"; attempt += 1) {
    if (payment.status !== "PROCESSING" && payment.status !== "UNKNOWN") break;
    await delay(1000);
    payment = await finance.payments.executePaymentIntent(intent.id, userId);
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

describe.skipIf(!enabled)("Release 4 finance verification", () => {
  it(
    "analytics reflects only verified transactions and categorizations",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      const payment = await send(alice.userId, bob.username, 50_000, "Netflix subscription");

      await finance.categories.ensureSystemCategories();
      const categories = await finance.categories.listCategories(alice.userId);
      const subscriptions = categories.find((c) => c.categoryType === "SUBSCRIPTIONS")!;
      await finance.categories.categorizeTransaction(alice.userId, {
        paymentRef: payment.paymentRef!,
        categoryId: subscriptions.id,
        note: "Monthly plan",
      });

      const overview = await finance.analytics.getFinanceOverview(alice.userId, "month");
      expect(overview.transactionCount).toBe(1);
      expect(overview.sentMinor).toBe(50_000);
      expect(overview.receivedMinor).toBe(0);
      expect(overview.netCashFlowMinor).toBe(-50_000);
      expect(overview.expenseMinor).toBe(50_000);
      expect(overview.categoryBreakdown[0]?.categoryType).toBe("SUBSCRIPTIONS");
      expect(overview.categoryBreakdown[0]?.amountMinor).toBe(50_000);
      expect(overview.insights.some((insight) => insight.message.includes("subscriptions"))).toBe(true);

      const bobOverview = await finance.analytics.getFinanceOverview(bob.userId, "month");
      expect(bobOverview.receivedMinor).toBe(50_000);

      const drilldown = await finance.analytics.getCategoryTransactions(
        alice.userId,
        subscriptions.id,
        "month",
      );
      expect(drilldown).toHaveLength(1);
      expect(drilldown[0]?.paymentRef).toBe(payment.paymentRef);
    },
    180_000,
  );

  it(
    "rules are deterministic and can be overridden manually",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 100_000);
      await send(alice.userId, bob.username, 20_000, "Uber ride home");

      await finance.categories.ensureSystemCategories();
      const categories = await finance.categories.listCategories(alice.userId);
      const transport = categories.find((c) => c.categoryType === "TRANSPORT")!;
      const food = categories.find((c) => c.categoryType === "FOOD_DINING")!;

      const rule = await finance.categories.createRule(alice.userId, {
        conditionType: "CONTAINS",
        conditionValue: "Uber",
        categoryId: transport.id,
        priority: 100,
        isEnabled: true,
      });
      expect(rule.conditionValue).toBe("Uber");

      const record = await prisma.transactionRecord.findFirstOrThrow({
        where: { userId: alice.userId, paymentRef: { not: null }, description: "Uber ride home" },
      });
      expect(await finance.categories.resolveTransactionCategory(alice.userId, record.paymentRef!, record.description)).toBe(transport.id);

      await finance.categories.categorizeTransaction(alice.userId, {
        paymentRef: record.paymentRef!,
        categoryId: food.id,
        note: "Corrected",
      });
      expect(await finance.categories.resolveTransactionCategory(alice.userId, record.paymentRef!, record.description)).toBe(food.id);

      const unchanged = await prisma.transactionRecord.findUniqueOrThrow({ where: { id: record.id } });
      expect(unchanged.description).toBe("Uber ride home");
    },
    120_000,
  );

  it(
    "budgets track eligible spending and notify each threshold once",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await finance.categories.ensureSystemCategories();
      const categories = await finance.categories.listCategories(alice.userId);
      const food = categories.find((c) => c.categoryType === "FOOD_DINING")!;

      const budget = await finance.budgets.createBudget(alice.userId, {
        name: "Monthly food",
        categoryId: food.id,
        amountMinor: 60_000,
        currency: "INR",
        periodType: "MONTHLY",
        startDate: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10),
        thresholds: [50, 75, 90, 100],
      });
      expect(budget.amountMinor).toBe(60_000);

      for (const amount of [20_000, 20_000]) {
        const payment = await send(alice.userId, bob.username, amount, "Dinner at a restaurant");
        await finance.categories.categorizeTransaction(alice.userId, {
          paymentRef: payment.paymentRef!,
          categoryId: food.id,
        });
      }

      const first = await finance.budgets.listBudgets(alice.userId);
      const firstBudget = first.items.find((item) => item.id === budget.id)!;
      expect(firstBudget.spentMinor).toBe(40_000);
      expect(firstBudget.utilization).toBeCloseTo(66.7, 1);
      expect(firstBudget.crossedThresholds).toEqual([50]);

      const second = await finance.budgets.listBudgets(alice.userId);
      expect(second.items.find((item) => item.id === budget.id)!.crossedThresholds).toEqual([]);

      const alerts = await prisma.budgetAlert.findMany({ where: { budgetId: budget.id } });
      expect(alerts).toHaveLength(1);
    },
    180_000,
  );

  it(
    "savings goals distinguish recorded from planned contributions",
    async () => {
      const alice = await createCustomer("alice");
      const goal = await finance.savings.createGoal(alice.userId, {
        name: "Laptop",
        targetAmountMinor: 50_000,
        currency: "INR",
      });
      const planned = await finance.savings.addContribution(alice.userId, goal.id, {
        amountMinor: 20_000,
        contributionType: "PLANNED",
      });
      expect(planned.recordedMinor).toBe(0);
      expect(planned.plannedMinor).toBe(20_000);
      expect(planned.status).toBe("ACTIVE");

      const recorded = await finance.savings.addContribution(alice.userId, goal.id, {
        amountMinor: 50_000,
        contributionType: "RECORDED",
      });
      expect(recorded.recordedMinor).toBe(50_000);
      expect(recorded.progress).toBe(100);
      expect(recorded.status).toBe("COMPLETED");

      await expectApiError(
        finance.savings.addContribution(alice.userId, goal.id, {
          amountMinor: 1_000,
          contributionType: "RECORDED",
        }),
        409,
      );
    },
    60_000,
  );

  it(
    "scheduled payments execute once through the existing engine",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);

      const schedule = await finance.scheduled.createScheduledPayment(alice.userId, {
        recipientQuery: bob.username,
        amountMinor: 10_000,
        currency: "INR",
        description: "Monthly rent",
        frequency: "MONTHLY",
        startDate: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(schedule.status).toBe("ACTIVE");

      const before = await client.getAccount(alice.accountId);
      const firstRun = await finance.engine.runDueExecutions(50);
      expect(firstRun.settled).toBeGreaterThanOrEqual(1);

      // A second worker must not create a second debit for the same occurrence.
      const secondRun = await finance.engine.runDueExecutions(50);
      expect(secondRun.settled).toBe(0);

      const after = await client.getAccount(alice.accountId);
      expect(before!.balanceCents - after!.balanceCents).toBe(10_000);

      const executions = await finance.scheduled.listExecutions(alice.userId, schedule.id);
      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe("SETTLED");
      expect(executions[0]!.paymentRef).toBeTruthy();

      const updated = await finance.scheduled.getScheduledPayment(alice.userId, schedule.id);
      expect(updated.executionCount).toBe(1);
      expect(new Date(updated.nextExecutionAt).getTime()).toBeGreaterThan(Date.now());

      const paused = await finance.scheduled.pauseScheduledPayment(alice.userId, schedule.id);
      expect(paused.status).toBe("PAUSED");
      const resumed = await finance.scheduled.resumeScheduledPayment(alice.userId, schedule.id);
      expect(resumed.status).toBe("ACTIVE");
      const cancelled = await finance.scheduled.cancelScheduledPayment(alice.userId, schedule.id);
      expect(cancelled.status).toBe("CANCELLED");
    },
    240_000,
  );

  it(
    "recurring suggestions are detected but never auto-scheduled",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 200_000);
      await send(alice.userId, bob.username, 30_000, "Weekly allowance");
      await send(alice.userId, bob.username, 30_000, "Weekly allowance");

      const suggestions = await finance.recurring.detectRecurringSuggestions(alice.userId);
      expect(suggestions.length).toBeGreaterThan(0);
      const suggestion = suggestions.find((item) => item.amountMinor === 30_000)!;
      expect(suggestion.status).toBe("SUGGESTED");
      expect(suggestion.confidence).toBeGreaterThan(0);

      const schedulesBefore = await finance.scheduled.listScheduledPayments(alice.userId);
      expect(schedulesBefore).toHaveLength(0);

      const confirmed = await finance.recurring.confirmSuggestion(alice.userId, suggestion.id);
      expect(confirmed.scheduleId).toBeTruthy();
      const schedulesAfter = await finance.scheduled.listScheduledPayments(alice.userId);
      expect(schedulesAfter).toHaveLength(1);

      const other = await createCustomer("charlie");
      const otherSuggestion = await finance.recurring.detectRecurringSuggestions(other.userId);
      expect(otherSuggestion).toHaveLength(0);
    },
    180_000,
  );

  it(
    "statements export verified records with matching totals and ownership checks",
    async () => {
      const alice = await createCustomer("alice");
      const bob = await createCustomer("bob");
      await fund(alice.userId, 100_000);
      await send(alice.userId, bob.username, 25_000, "Statement test payment");

      const today = new Date();
      const periodStart = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const periodEnd = today.toISOString().slice(0, 10);

      const pdf = await finance.statements.generateStatement(alice.userId, {
        format: "PDF",
        periodStart,
        periodEnd,
      });
      expect(pdf.status).toBe("READY");
      expect(pdf.totals.outflowMinor).toBe(25_000);
      expect(pdf.totals.transactionCount).toBe(1);

      const csv = await finance.statements.generateStatement(alice.userId, {
        format: "CSV",
        periodStart,
        periodEnd,
      });
      expect(csv.totals.outflowMinor).toBe(25_000);

      const file = await finance.statements.downloadStatement(alice.userId, pdf.id);
      expect(file.fileName.endsWith(".pdf")).toBe(true);
      expect(file.buffer[0]).toBe(0x25);

      const csvFile = await finance.statements.downloadStatement(alice.userId, csv.id);
      expect(csvFile.fileName.endsWith(".csv")).toBe(true);
      expect(csvFile.buffer.toString("utf8")).toContain("Statement test payment");

      await expectApiError(finance.statements.downloadStatement(bob.userId, pdf.id), 404);
      await expectApiError(finance.statements.getStatement(bob.userId, pdf.id), 404);
    },
    180_000,
  );
});
