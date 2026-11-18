import { createHash } from "node:crypto";
import { prisma } from "@nexus/database";
import type {
  CashFlowView, CategorySpendView, DataQualityView, FinanceOverviewExtended,
  FinancePeriod, MerchantSpendView,
} from "@nexus/shared-types";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { listBudgets } from "@/lib/finance/budget-service";
import { listGoals } from "@/lib/finance/savings-service";
import { listScheduledPayments } from "@/lib/finance/scheduled-payment-service";
import {
  loadClassifiedTransactions, moneyMovements, type ClassifiedRecord,
} from "@/lib/finance-intelligence/classification-service";

export interface FinanceWindow {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  label: string;
}

export function resolveFinancePeriod(period: FinancePeriod, from?: string, to?: string): FinanceWindow {
  const now = new Date();


  const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const shift = (date: Date, months: number) =>
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));

  if (from && to) {
    const windowFrom = new Date(`${from}T00:00:00.000Z`);
    const windowTo = new Date(`${to}T23:59:59.999Z`);
    const span = windowTo.getTime() - windowFrom.getTime();
    return {
      from: windowFrom, to: windowTo,
      previousFrom: new Date(windowFrom.getTime() - span - 1),
      previousTo: new Date(windowFrom.getTime() - 1),
      label: "Custom range",
    };
  }
  switch (period) {
    case "week": {
      const fromDate = new Date(now.getTime() - 7 * 86_400_000);
      return { from: fromDate, to: now, previousFrom: new Date(fromDate.getTime() - 7 * 86_400_000), previousTo: fromDate, label: "This week" };
    }
    case "last_month": {
      const toDate = startOfMonth(now);
      const fromDate = new Date(toDate.getTime() - 1);
      fromDate.setUTCDate(1);
      return { from: fromDate, to: new Date(toDate.getTime() - 1), previousFrom: shift(fromDate, -1), previousTo: new Date(fromDate.getTime() - 1), label: "Last month" };
    }
    case "quarter": {
      const fromDate = new Date(now.getTime() - 90 * 86_400_000);
      return { from: fromDate, to: now, previousFrom: new Date(fromDate.getTime() - 90 * 86_400_000), previousTo: fromDate, label: "Last 3 months" };
    }
    case "half_year": {
      const fromDate = new Date(now.getTime() - 182 * 86_400_000);
      return { from: fromDate, to: now, previousFrom: new Date(fromDate.getTime() - 182 * 86_400_000), previousTo: fromDate, label: "Last 6 months" };
    }
    case "year": {
      const fromDate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
      return { from: fromDate, to: now, previousFrom: new Date(fromDate.getTime() - (now.getTime() - fromDate.getTime())), previousTo: fromDate, label: "This year" };
    }
    case "month":
    default: {
      const fromDate = startOfMonth(now);
      const prevTo = new Date(fromDate.getTime() - 1);
      const prevFrom = startOfMonth(prevTo);
      return { from: fromDate, to: now, previousFrom: prevFrom, previousTo: prevTo, label: "This month" };
    }
  }
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function categoryForRecord(record: ClassifiedRecord, categorizations: Map<string, string>): string {
  if (record.sourceType === "MERCHANT_PAYMENT") return record.category === "SUBSCRIPTION" ? "SUBSCRIPTIONS" : "SHOPPING";
  if (record.paymentRef && categorizations.has(record.paymentRef)) return categorizations.get(record.paymentRef)!;
  const text = `${record.description} ${record.merchantName ?? ""}`.toLowerCase();
  if (/food|restaurant|cafe|swiggy|zomato/.test(text)) return "FOOD_DINING";
  if (/grocery|supermarket|bigbasket/.test(text)) return "GROCERIES";
  if (/transport|uber|ola|petrol|fuel/.test(text)) return "TRANSPORT";
  if (/salary|income/.test(text)) return "INCOME";
  return "OTHER";
}

export async function loadCategorizationMap(userId: string): Promise<Map<string, string>> {
  const rows = await prisma.transactionCategorization.findMany({
    where: { userId },
    include: { category: true },
  });
  return new Map(
    rows.map((row) => [row.paymentRef, row.category.name]).filter((entry): entry is [string, string] => Boolean(entry[0])),
  );
}

export async function getCashFlow(
  userId: string,
  period: FinancePeriod,
  from?: string,
  to?: string,
): Promise<CashFlowView> {
  const window = resolveFinancePeriod(period, from, to);
  const result = await loadClassifiedTransactions(userId, window.from, window.to);
  const monetary = result.records.filter(
    (record) => !["REWARD", "GROUP_SETTLEMENT", "INTERNAL_TRANSFER"].includes(record.category),
  );
  const totals = moneyMovements(result.records);
  const byDay = new Map<string, { date: string; inflowMinor: number; outflowMinor: number; netMinor: number; transactionCount: number }>();
  for (const record of monetary) {
    const key = dayKey(record.occurredAt);
    const entry = byDay.get(key) ?? { date: key, inflowMinor: 0, outflowMinor: 0, netMinor: 0, transactionCount: 0 };
    if (record.direction === "IN" && !record.isAdjustment) entry.inflowMinor += record.amountMinor;
    else if (record.direction === "OUT") entry.outflowMinor += record.amountMinor;
    entry.transactionCount += 1;
    byDay.set(key, entry);
  }
  const points = [...byDay.values()]
    .map((point) => ({ ...point, netMinor: point.inflowMinor - point.outflowMinor }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const days = Math.max(1, Math.ceil((window.to.getTime() - window.from.getTime()) / 86_400_000));
  const expenseRecords = monetary.filter((record) => record.direction === "OUT" && !record.isAdjustment);
  const incomeRecords = monetary.filter((record) => record.direction === "IN" && !record.isAdjustment);
  const maxExpense = expenseRecords.reduce<ClassifiedRecord | null>((max, r) => (!max || r.amountMinor > max.amountMinor ? r : max), null);
  const maxIncome = incomeRecords.reduce<ClassifiedRecord | null>((max, r) => (!max || r.amountMinor > max.amountMinor ? r : max), null);
  return {
    period,
    points,
    totalInflowMinor: totals.inflowMinor,
    totalOutflowMinor: totals.outflowMinor,
    netMinor: totals.netMinor,
    averageDailySpendMinor: Math.round(totals.outflowMinor / days),
    averageWeeklySpendMinor: Math.round((totals.outflowMinor / days) * 7),
    averageMonthlySpendMinor: Math.round((totals.outflowMinor / days) * 30),
    highestSpendingDay: points.reduce<(typeof points)[number] | null>((max, p) => (!max || p.outflowMinor > max.outflowMinor ? p : max), null),
    lowestSpendingDay: points.length
      ? points.reduce<(typeof points)[number] | null>((min, p) => (!min || p.outflowMinor < min.outflowMinor ? p : min), null)
      : null,
    largestExpenseMinor: maxExpense?.amountMinor ?? 0,
    largestIncomeMinor: maxIncome?.amountMinor ?? 0,
    currency: "INR",
    definitions: {
      inflowMinor: "Verified P2P receipts plus cashback counted only after verified wallet credit. Simulated funding excluded.",
      outflowMinor: "Successful merchant payments and P2P sends, reduced by refund adjustments. Internal transfers and group settlements excluded.",
      netMinor: "inflowMinor minus outflowMinor.",
      averageDailySpendMinor: "outflowMinor divided by the number of days in the selected period.",
    },
  };
}

export async function getCategorySpend(userId: string, period: FinancePeriod, from?: string, to?: string): Promise<CategorySpendView[]> {
  const window = resolveFinancePeriod(period, from, to);
  const [current, previous, map] = await Promise.all([
    loadClassifiedTransactions(userId, window.from, window.to),
    loadClassifiedTransactions(userId, window.previousFrom, window.previousTo),
    loadCategorizationMap(userId),
  ]);
  const sumByCategory = (result: typeof current) => {
    const totals = new Map<string, number>();
    for (const record of result.records) {
      if (record.direction !== "OUT" || record.isAdjustment || record.category === "REWARD") continue;
      const category = categoryForRecord(record, map);
      totals.set(category, (totals.get(category) ?? 0) + record.amountMinor);
    }
    return totals;
  };
  const currentTotals = sumByCategory(current);
  const previousTotals = sumByCategory(previous);
  return [...currentTotals.entries()]
    .map(([category, amountMinor]) => {
      const before = previousTotals.get(category) ?? 0;
      return {
        category, amountMinor,
        transactionCount: current.records.filter((r) => r.direction === "OUT" && categoryForRecord(r, map) === category).length,
        changeBps: before > 0 ? Math.round(((amountMinor - before) / before) * 10_000) : null,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export async function getMerchantSpend(userId: string, period: FinancePeriod, from?: string, to?: string): Promise<MerchantSpendView[]> {
  const window = resolveFinancePeriod(period, from, to);
  const result = await loadClassifiedTransactions(userId, window.from, window.to);
  const totals = new Map<string, { amountMinor: number; count: number }>();
  for (const record of result.records) {
    if (record.direction !== "OUT" || record.isAdjustment || record.category === "REWARD") continue;
    const name = record.merchantName ?? "Merchant";
    const entry = totals.get(name) ?? { amountMinor: 0, count: 0 };
    entry.amountMinor += record.amountMinor;
    entry.count += 1;
    totals.set(name, entry);
  }
  return [...totals.entries()]
    .map(([merchant, value]) => ({ merchant, amountMinor: value.amountMinor, transactionCount: value.count, changeBps: null }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

export async function getExtendedOverview(userId: string, period: FinancePeriod, from?: string, to?: string): Promise<FinanceOverviewExtended> {
  const window = resolveFinancePeriod(period, from, to);
  const [current, previous, wallet, budgets, goals, scheduled, upcomingSubscriptions] = await Promise.all([
    loadClassifiedTransactions(userId, window.from, window.to),
    loadClassifiedTransactions(userId, window.previousFrom, window.previousTo),
    getWalletOverviewForUser(userId),
    listBudgets(userId),
    listGoals(userId),
    listScheduledPayments(userId),
    prisma.subscription.findMany({
      where: { customerUserId: userId, nextBillingDate: { gte: window.from, lte: window.to }, status: { in: ["ACTIVE", "TRIALING"] } },
      select: { pricingSnapshot: true },
    }),
  ]);
  const totals = moneyMovements(current.records);
  const previousTotals = moneyMovements(previous.records);
  const budgetList = budgets.items ?? [];
  const budgetUtilisation = budgetList.length
    ? Math.round((budgetList.reduce((sum, budget) => sum + (budget.utilization ?? 0), 0) / budgetList.length) * 100)
    : null;
  const goalList = goals.items ?? [];
  const goalProgress = goalList.length
    ? Math.round(goalList.reduce((sum, goal) => sum + (goal.progress ?? 0), 0) / goalList.length)
    : null;
  const moneyMinor = wallet?.balance?.availableMinor ?? 0;
  const upcomingScheduledMinor = scheduled
    .filter((item) => item.status === "ACTIVE")
    .reduce((sum, item) => sum + item.amountMinor, 0);
  const upcomingSubscriptionMinor = upcomingSubscriptions.reduce((sum, item) => {
    const snapshot = item.pricingSnapshot as { amountMinor?: number };
    return sum + (snapshot.amountMinor ?? 0);
  }, 0);
  const months = Math.max(1, Math.round((window.to.getTime() - window.from.getTime()) / (30 * 86_400_000)));

  return {
    period: {
      label: window.label, from: window.from.toISOString(), to: window.to.toISOString(),
      previousFrom: window.previousFrom.toISOString(), previousTo: window.previousTo.toISOString(),
    },
    walletBalanceMinor: moneyMinor,
    inflowMinor: totals.inflowMinor,
    outflowMinor: totals.outflowMinor,
    netCashFlowMinor: totals.netMinor,
    savingsEstimateMinor: Math.max(0, Math.round(totals.netMinor / months)),
    currentMonthSpendMinor: totals.outflowMinor,
    budgetUtilisationBps: budgetUtilisation,
    upcomingScheduledMinor,
    upcomingSubscriptionMinor,
    cashbackCreditedMinor: current.records
      .filter((r) => r.category === "CASHBACK")
      .reduce((sum, r) => sum + r.amountMinor, 0),
    goalProgressBps: goalProgress,
    previous: { ...previousTotals, netCashFlowMinor: previousTotals.netMinor },
    completenessBps: current.completenessBps,
    currency: "INR",
    notice: "Wallet balance is a live Raftline read, not net worth. Income/expenses are derived from verified records only.",
  };
}

export async function getDataQuality(userId: string, period: FinancePeriod, from?: string, to?: string): Promise<DataQualityView> {
  const window = resolveFinancePeriod(period, from, to);
  const result = await loadClassifiedTransactions(userId, window.from, window.to);
  return {
    completenessBps: result.completenessBps,
    classifiedRecords: result.records.filter((r) => r.classificationSource !== "RULE").length,
    totalRecords: result.records.length,
    issues: result.issues.slice(0, 50).map((issue) => ({
      code: issue.code, severity: issue.severity, details: issue.details, at: new Date().toISOString(),
    })),
    currency: "INR",
  };
}

/** Persist a rebuildable derived snapshot; never used as an authoritative ledger. */
export async function persistSnapshot(
  userId: string,
  period: FinancePeriod,
  kind: string,
  from?: string,
  to?: string,
): Promise<void> {
  const window = resolveFinancePeriod(period, from, to);
  const payload =
    kind === "CASH_FLOW"
      ? await getCashFlow(userId, period, from, to)
      : await getCategorySpend(userId, period, from, to);
  const periodKey = `${window.from.toISOString()}:${window.to.toISOString()}`;
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  await prisma.financialAggregationSnapshot.upsert({
    where: { userId_periodKey_kind: { userId, periodKey, kind } },
    create: { userId, periodKey, kind, periodStart: window.from, periodEnd: window.to, payload: payload as object, checksum },
    update: { payload: payload as object, checksum },
  });
}

export const FINANCE_AGGREGATION_DEFINITIONS = {
  inflow: "Verified P2P receipts plus cashback after verified wallet credit; simulated funding excluded.",
  outflow: "Successful merchant purchases, P2P sends and subscription payments, reduced by refund adjustments.",
  excluded: "Internal transfers, group expense/settlement pairs and reward points are excluded from money totals.",
};

