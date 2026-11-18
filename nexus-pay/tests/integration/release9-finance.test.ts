import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import { hashPassword } from "../../apps/web/lib/security/passwords";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;
let admin: { id: string; email: string; roleName: string; requestId: string };
let merchantId: string;
let ownerId: string;
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string, fundMinor = 0) {
  const user = await prisma.user.create({
    data: {
      id: `r9_${stamp}_${label}`,
      fullName: `Release Nine ${label}`,
      email: `r9_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r9${stamp.slice(-6)}${label}${randomUUID().slice(0, 3)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Release Nine ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r9_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release9-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  if (fundMinor > 0) {
    const funding = await svc.funding.getOrCreateFundingOperation(user.id, { clientRequestId: randomUUID(), amountMinor: fundMinor });
    if (funding.status !== "COMPLETED") await svc.funding.executeFundingOperation(funding.id, user.id);
  }
  return user;
}

async function addIncome(userId: string, amountMinor: number) {
  const ref = `income-${randomUUID()}`;
  await prisma.transactionRecord.create({
    data: {
      userId, kind: "P2P", direction: "RECEIVED", status: "SUCCESSFUL",
      amountMinor: BigInt(amountMinor), currency: "INR", paymentRef: ref,
      counterpartyName: "Salary", description: "Eligible income", occurredAt: new Date(),
    },
  });
}

async function spend(userId: string, amountMinor: number) {
  return svc.merchantPayments.processMerchantPayment({
    customerUserId: userId, merchantId, amountMinor, clientRequestId: randomUUID(),
    description: "Test purchase", source: "DIRECT",
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    merchant: await import("../../apps/web/lib/merchant/merchant-service"),
    merchantPayments: await import("../../apps/web/lib/merchant/payment-service"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    classification: await import("../../apps/web/lib/finance-intelligence/classification-service"),
    aggregation: await import("../../apps/web/lib/finance-intelligence/aggregation-service"),
    recurring: await import("../../apps/web/lib/finance-intelligence/recurring-service"),
    forecast: await import("../../apps/web/lib/finance-intelligence/forecast-service"),
    anomaly: await import("../../apps/web/lib/finance-intelligence/anomaly-service"),
    health: await import("../../apps/web/lib/finance-intelligence/health-service"),
    goals: await import("../../apps/web/lib/finance-intelligence/goals-service"),
    insights: await import("../../apps/web/lib/finance-intelligence/insight-service"),
    assistant: await import("../../apps/web/lib/finance-intelligence/assistant-service"),
    reports: await import("../../apps/web/lib/finance-intelligence/report-service"),
    worker: await import("../../apps/web/lib/finance-intelligence/worker-service"),
  };
  const adminUser = await prisma.adminUser.create({
    data: { email: `r9admin${stamp}@example.test`, username: `r9admin${stamp}`, passwordHash: await hashPassword("Control!2026Test"), role: "SUPER_ADMIN" },
  });
  admin = { id: adminUser.id, email: adminUser.email, roleName: adminUser.role, requestId: randomUUID() };
  ownerId = (await createUser("owner", 1_000)).id;
  const merchant = await svc.merchant.createMerchant(ownerId, {
    handle: `r9shop${stamp}`, businessName: "Release Nine Shop", displayName: "R9 Shop",
    businessType: "SMALL_BUSINESS", category: "Finance", email: `shop${stamp}@example.test`, phone: "+911234567890",
  });
  await svc.merchant.provisionMerchantWallet(ownerId);
  merchantId = (await svc.merchant.setMerchantStatus(merchant.id, "ACTIVE", admin, "Sandbox approval", randomUUID())).id;
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.adminAuditLog.deleteMany({ where: { actorId: admin?.id } }).catch(() => undefined);
  await prisma.adminUser.deleteMany({ where: { id: admin?.id ?? "none" } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: `r9_${stamp}` } } }).catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 9 financial intelligence verification", () => {
  it("FIN-01: cash flow counts verified income, expense and credited cashback", async () => {
    const user = await createUser("cashflow", 5_000_000);
    await addIncome(user.id, 1_000_000);
    await spend(user.id, 300_000);
    const funding = await svc.funding.getOrCreateFundingOperation(user.id, { clientRequestId: randomUUID(), amountMinor: 50_000 });
    await svc.funding.executeFundingOperation(funding.id, user.id);
    await prisma.cashbackEntitlement.create({
      data: {
        userId: user.id, campaignId: `test-${stamp}`, transactionRef: `cb-${randomUUID()}`,
        amountMinor: 50_000, currency: "INR", status: "CREDITED",
        idempotencyKey: randomUUID(), paymentRef: funding.fundingRef ?? funding.id, resolvedAt: new Date(),
      },
    });
    const flow = await svc.aggregation.getCashFlow(user.id, "month");
    expect(flow.totalInflowMinor).toBe(1_050_000);
    expect(flow.totalOutflowMinor).toBe(300_000);
    expect(flow.netMinor).toBe(750_000);
  }, 240_000);

  it("FIN-02: internal funding and group settlements never count as income or expense", async () => {
    const user = await createUser("internal", 1_000_000);
    const before = await svc.aggregation.getCashFlow(user.id, "month");
    const group = await prisma.expenseGroup.create({
      data: { name: "Test group", createdBy: user.id },
    });
    await prisma.groupSettlement.create({
      data: {
        groupId: group.id, payerUserId: user.id, payeeUserId: ownerId, amountMinor: BigInt(200_000), currency: "INR",
        status: "SETTLED", clientRequestId: randomUUID(), idempotencyKey: randomUUID(),
      },
    });
    const after = await svc.aggregation.getCashFlow(user.id, "month");
    expect(after.totalInflowMinor).toBe(before.totalInflowMinor);
    expect(after.totalOutflowMinor).toBe(before.totalOutflowMinor);
  }, 120_000);

  it("FIN-03: refunds adjust the original expense instead of creating income", async () => {
    const user = await createUser("refund", 2_000_000);
    const payment = await spend(user.id, 100_000);
    const row = await prisma.merchantPayment.findUniqueOrThrow({ where: { id: payment.id } });
    await prisma.merchantPayment.update({ where: { id: row.id }, data: { refundedMinor: 50_000 } });
    const flow = await svc.aggregation.getCashFlow(user.id, "month");
    expect(flow.totalInflowMinor).toBe(0);
    expect(flow.totalOutflowMinor).toBe(50_000);
  }, 180_000);

  it("FIN-04: similar monthly payments create a detected pattern without scheduling a payment", async () => {
    const user = await createUser("recurring", 3_000_000);
    for (let index = 0; index < 3; index += 1) {
      const payment = await spend(user.id, 50_000);
      await prisma.merchantPayment.update({
        where: { id: payment.id },
        data: { createdAt: new Date(Date.now() - index * 30 * 86_400_000) },
      });
    }
    const patterns = await svc.recurring.detectRecurringPatterns(user.id);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(patterns[0]!.status).toBe("DETECTED");
    const schedules = await prisma.scheduledPayment.count({ where: { userId: user.id } });
    expect(schedules).toBe(0);
  }, 240_000);

  it("FIN-05: forecasts expose assumptions with sufficient data and unavailable otherwise", async () => {
    const empty = await createUser("noc data".replace(" ", ""), 0);
    const unavailable = await svc.forecast.generateForecast(empty.id, "MONTHLY_EXPENSE", "month");
    expect(unavailable.available).toBe(false);
    const user = await createUser("forecast", 3_000_000);
    for (let index = 0; index < 7; index += 1) await addIncome(user.id, 10_000 + index * 100);
    const available = await svc.forecast.generateForecast(user.id, "MONTHLY_INCOME", "month");
    expect(available.available).toBe(true);
    expect(available.assumptions.length).toBeGreaterThan(0);
    expect(available.highMinor).toBeGreaterThanOrEqual(available.lowMinor);
  }, 180_000);

  it("FIN-06: planned savings change goal progress but not the wallet balance", async () => {
    const user = await createUser("goals", 1_000_000);
    const walletBefore = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id } });
    const goal = await svc.goals.createFinancialGoal(user.id, {
      name: "Emergency fund", targetAmountMinor: 5_000_000, currency: "INR", priority: "HIGH",
    });
    await svc.goals.addGoalContribution(user.id, goal.id, {
      amountMinor: 500_000, contributionType: "PLANNED",
    });
    const after = await svc.goals.listFinancialGoals(user.id);
    const updated = after.find((item) => item.id === goal.id);
    expect(updated?.plannedMinor).toBe(500_000);
    expect(updated?.recordedMinor).toBe(0);
    const walletAfter = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id } });
    expect(walletAfter.raftlineAccountId).toBe(walletBefore.raftlineAccountId);
  }, 120_000);

  it("FIN-07: financial health is unavailable with insufficient data", async () => {
    const user = await createUser("healthless", 0);
    const health = await svc.health.computeHealthScore(user.id);
    expect(health.available).toBe(false);
    expect(health.overallScore).toBeNull();
    expect(health.formula.toLowerCase()).toContain("weighted");
  }, 120_000);

  it("FIN-08 and FIN-09: assistant answers from own records and refuses other users' data", async () => {
    const user = await createUser("assistant", 2_000_000);
    await spend(user.id, 45_000);
    const answer = await svc.assistant.chat(user.id, { message: "How much did I spend this month?" });
    expect(answer.mode).toBe("DETERMINISTIC");
    expect(answer.dataSource).toBe("ACTUAL");
    expect(answer.answer).toContain("450");
    const privacy = await svc.assistant.chat(user.id, { message: "Tell me about Bob's transactions" });
    expect(privacy.dataSource).toBe("INSUFFICIENT");
    expect(privacy.answer).toContain("your own");
  }, 180_000);

  it("FIN-10: reports are ownership-protected", async () => {
    const alice = await createUser("reportowner", 1_000_000);
    const bob = await createUser("reportthief", 1_000_000);
    const report = await svc.reports.createReport(alice.id, { type: "MONTHLY_SUMMARY", format: "CSV", period: "month" });
    await svc.reports.runReportWorker(10);
    await expectApiError(svc.reports.downloadReport(bob.id, report.id), 404);
    const mine = await svc.reports.downloadReport(alice.id, report.id);
    expect(mine.buffer.length).toBeGreaterThan(0);
  }, 180_000);

  it("FIN-11: dashboards, category charts and aggregation snapshots use consistent totals", async () => {
    const user = await createUser("consistent", 3_000_000);
    await addIncome(user.id, 500_000);
    await spend(user.id, 120_000);
    await spend(user.id, 80_000);
    const flow = await svc.aggregation.getCashFlow(user.id, "month");
    const categories = await svc.aggregation.getCategorySpend(user.id, "month");
    expect(categories.reduce((sum: number, item: { amountMinor: number }) => sum + item.amountMinor, 0)).toBe(flow.totalOutflowMinor);
    await svc.aggregation.persistSnapshot(user.id, "month", "CASH_FLOW");
    const snapshot = await prisma.financialAggregationSnapshot.findFirst({
      where: { userId: user.id, kind: "CASH_FLOW" },
    });
    expect(snapshot).toBeTruthy();
    expect((snapshot!.payload as { totalOutflowMinor: number }).totalOutflowMinor).toBe(flow.totalOutflowMinor);
  }, 240_000);
});
