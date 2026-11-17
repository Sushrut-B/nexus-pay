import { prisma, type TransactionRecord, type TransactionCategory } from "@nexus/database";
import type {
  CashFlowPoint,
  CategoryBreakdown,
  CategoryType,
  FinanceInsight,
  FinanceOverview,
  InsightPeriod,
} from "@nexus/shared-types";
import { formatMinorCurrency } from "@nexus/shared-types";
import { getWalletOverviewForUser } from "@/lib/wallet/service";
import { resolveTransactionCategory } from "@/lib/finance/category-service";
import { toTransactionSummary } from "@/lib/payments/dto";

/**
 * Transaction inclusion policy (documented, deterministic):
 * - Only SUCCESSFUL P2P transactions with a ledger payment reference count.
 * - FUNDING (simulated reserve credits) is never income.
 * - Failed, processing, cancelled and unconfirmed payments are excluded.
 * - Idempotent replays cannot duplicate totals because the transaction read
 *   model is unique per (user, paymentRef).
 * - Group expense obligations are not transactions and are never counted; a
 *   group settlement is a real P2P payment and is counted exactly once.
 * - Personal transfers and group expenses are excluded from "spending" so a
 *   reimbursement is not mistaken for consumption.
 */
export const SPENDING_CATEGORY_TYPES: CategoryType[] = [
  "FOOD_DINING",
  "GROCERIES",
  "SHOPPING",
  "TRANSPORT",
  "TRAVEL",
  "ENTERTAINMENT",
  "RENT_HOUSING",
  "UTILITIES",
  "HEALTHCARE",
  "EDUCATION",
  "SUBSCRIPTIONS",
  "OTHER",
  "UNCATEGORIZED",
];

export interface ResolvedPeriod {
  start: Date;
  end: Date;
  label: string;
  previousStart: Date;
  previousEnd: Date;
}

export function resolvePeriod(period: InsightPeriod, from?: string, to?: string): ResolvedPeriod {
  const now = new Date();
  const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  switch (period) {
    case "last_month": {
      const end = startOfMonth(now);
      const start = startOfMonth(new Date(end.getTime() - 1));
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = startOfMonth(prevEnd);
      return { start, end, label: "Last month", previousStart: prevStart, previousEnd: prevEnd };
    }
    case "last_3_months": {
      const end = new Date(now);
      const start = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)));
      const previousEnd = new Date(start.getTime() - 1);
      const previousStart = startOfMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 2, 1)));
      return { start, end, label: "Last 3 months", previousStart, previousEnd: previousEnd };
    }
    case "last_6_months": {
      const end = new Date(now);
      const start = startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));
      const previousEnd = new Date(start.getTime() - 1);
      const previousStart = startOfMonth(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 5, 1)));
      return { start, end, label: "Last 6 months", previousStart, previousEnd: previousEnd };
    }
    case "year": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const previousEnd = new Date(start.getTime() - 1);
      const previousStart = new Date(Date.UTC(start.getUTCFullYear() - 1, 0, 1));
      return { start, end: new Date(now), label: "This year", previousStart, previousEnd };
    }
    case "custom": {
      const start = from
        ? new Date(`${from}T00:00:00.000Z`)
        : startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
      const end = to ? new Date(`${to}T23:59:59.999Z`) : new Date(now);
      const length = end.getTime() - start.getTime();
      return {
        start,
        end,
        label: "Custom range",
        previousStart: new Date(start.getTime() - length),
        previousEnd: new Date(start.getTime() - 1),
      };
    }
    case "month":
    default: {
      const start = startOfMonth(now);
      const end = new Date(now);
      const previousEnd = new Date(start.getTime() - 1);
      const previousStart = startOfMonth(previousEnd);
      return { start, end, label: "This month", previousStart, previousEnd };
    }
  }
}

interface EnrichedTransaction extends TransactionRecord {
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
}

async function loadEnrichedTransactions(userId: string): Promise<EnrichedTransaction[]> {
  const records = await prisma.transactionRecord.findMany({
    where: {
      userId,
      status: "SUCCESSFUL",
      kind: "P2P",
      paymentRef: { not: null },
    },
    orderBy: { occurredAt: "asc" },
    take: 5_000,
  });

  const categories = await prisma.transactionCategory.findMany({
    where: { OR: [{ userId: null }, { userId }] },
  });
  const categoryById = new Map<string, TransactionCategory>(categories.map((c) => [c.id, c]));

  const enriched: EnrichedTransaction[] = [];
  for (const record of records) {
    const categoryId = await resolveTransactionCategory(userId, record.paymentRef!, record.description);
    const category = categoryById.get(categoryId);
    enriched.push({
      ...record,
      categoryId,
      categoryName: category?.name ?? "Uncategorized",
      categoryType: category?.categoryType ?? "UNCATEGORIZED",
    });
  }
  return enriched;
}

function inRange(record: TransactionRecord, start: Date, end: Date): boolean {
  return record.occurredAt >= start && record.occurredAt <= end;
}

function sum(records: TransactionRecord[]): number {
  return records.reduce((total, record) => total + Number(record.amountMinor), 0);
}

function bucketize(
  records: EnrichedTransaction[],
  start: Date,
  end: Date,
  granularity: "day" | "week" | "month",
): CashFlowPoint[] {
  const buckets = new Map<string, CashFlowPoint>();
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    const key = bucketKey(cursor, granularity);
    buckets.set(key, { label: bucketLabel(cursor, granularity), inflowMinor: 0, outflowMinor: 0, netMinor: 0 });
    advance(cursor, granularity);
  }
  for (const record of records) {
    if (!inRange(record, start, end)) continue;
    const key = bucketKey(record.occurredAt, granularity);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (record.direction === "RECEIVED") bucket.inflowMinor += Number(record.amountMinor);
    else bucket.outflowMinor += Number(record.amountMinor);
    bucket.netMinor = bucket.inflowMinor - bucket.outflowMinor;
  }
  return [...buckets.values()];
}

function bucketKey(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "week") {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dow = day.getUTCDay();
    day.setUTCDate(day.getUTCDate() - ((dow + 6) % 7));
    return day.toISOString().slice(0, 10);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function bucketLabel(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }
  if (granularity === "week") {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dow = day.getUTCDay();
    day.setUTCDate(day.getUTCDate() - ((dow + 6) % 7));
    return `Week of ${new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(day)}`;
  }
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
}

function advance(date: Date, granularity: "day" | "week" | "month"): void {
  if (granularity === "day") date.setUTCDate(date.getUTCDate() + 1);
  else if (granularity === "week") date.setUTCDate(date.getUTCDate() + 7);
  else date.setUTCMonth(date.getUTCMonth() + 1);
}

function buildCategoryBreakdown(
  current: EnrichedTransaction[],
  previous: EnrichedTransaction[],
): CategoryBreakdown[] {
  const spendingCurrent = current.filter(
    (record) => record.direction === "SENT" && SPENDING_CATEGORY_TYPES.includes(record.categoryType),
  );
  const spendingPrevious = previous.filter(
    (record) => record.direction === "SENT" && SPENDING_CATEGORY_TYPES.includes(record.categoryType),
  );

  const currentMap = new Map<string, { name: string; type: CategoryType; amount: number; count: number }>();
  for (const record of spendingCurrent) {
    const entry = currentMap.get(record.categoryId) ?? {
      name: record.categoryName,
      type: record.categoryType,
      amount: 0,
      count: 0,
    };
    entry.amount += Number(record.amountMinor);
    entry.count += 1;
    currentMap.set(record.categoryId, entry);
  }

  const previousMap = new Map<string, number>();
  for (const record of spendingPrevious) {
    previousMap.set(record.categoryId, (previousMap.get(record.categoryId) ?? 0) + Number(record.amountMinor));
  }

  const total = [...currentMap.values()].reduce((sum, entry) => sum + entry.amount, 0);

  return [...currentMap.entries()]
    .map(([categoryId, entry]) => {
      const previousAmount = previousMap.get(categoryId) ?? 0;
      const change = entry.amount - previousAmount;
      const changePercentage = previousAmount === 0 ? null : Math.round((change / previousAmount) * 1000) / 10;
      const trend: CategoryBreakdown["trend"] =
        previousAmount === 0
          ? entry.amount > 0
            ? "new"
            : "flat"
          : change > 0
            ? "up"
            : change < 0
              ? "down"
              : "flat";
      return {
        categoryId,
        categoryName: entry.name,
        categoryType: entry.type,
        amountMinor: entry.amount,
        percentage: total === 0 ? 0 : Math.round((entry.amount / total) * 1000) / 10,
        transactionCount: entry.count,
        previousAmountMinor: previousAmount,
        changeMinor: change,
        changePercentage,
        trend,
      };
    })
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

function buildInsights(
  current: EnrichedTransaction[],
  previous: EnrichedTransaction[],
  breakdown: CategoryBreakdown[],
  periodLabel: string,
): FinanceInsight[] {
  const insights: FinanceInsight[] = [];
  const uncategorized = current.filter(
    (record) => record.direction === "SENT" && record.categoryType === "UNCATEGORIZED",
  );
  if (uncategorized.length > 0) {
    insights.push({
      type: "info",
      message: `You have ${uncategorized.length} uncategorized spending transaction${uncategorized.length === 1 ? "" : "s"}.`,
    });
  }

  const top = breakdown[0];
  if (top && top.changePercentage !== null && top.changeMinor !== 0) {
    const direction = top.changeMinor > 0 ? "more" : "less";
    insights.push({
      type: top.changeMinor > 0 ? "warning" : "positive",
      message: `You spent ${formatMinorCurrency(Math.abs(top.changeMinor), "INR")} ${direction} on ${top.categoryName} than the previous period.`,
    });
  }

  const subscriptions = current.filter(
    (record) => record.direction === "SENT" && record.categoryType === "SUBSCRIPTIONS",
  );
  if (subscriptions.length > 0) {
    insights.push({
      type: "info",
      message: `Your subscriptions total ${formatMinorCurrency(sum(subscriptions), "INR")} in ${periodLabel.toLowerCase()}.`,
    });
  }

  if (current.length === 0) {
    insights.push({ type: "info", message: "No confirmed transactions in this period yet." });
  }

  return insights.slice(0, 4);
}

export async function getFinanceOverview(
  userId: string,
  period: InsightPeriod,
  from?: string,
  to?: string,
): Promise<FinanceOverview> {
  const resolved = resolvePeriod(period, from, to);
  const enriched = await loadEnrichedTransactions(userId);

  const current = enriched.filter((record) => inRange(record, resolved.start, resolved.end));
  const previous = enriched.filter((record) => inRange(record, resolved.previousStart, resolved.previousEnd));

  const received = current.filter((record) => record.direction === "RECEIVED");
  const sent = current.filter((record) => record.direction === "SENT");
  const spending = sent.filter((record) => SPENDING_CATEGORY_TYPES.includes(record.categoryType));

  const receivedMinor = sum(received);
  const sentMinor = sum(sent);
  const expenseMinor = sum(spending);
  const netCashFlowMinor = receivedMinor - sentMinor;

  const overview = await getWalletOverviewForUser(userId).catch(() => null);
  const walletBalanceMinor = overview?.balance?.availableMinor ?? null;
  const savingsEstimateMinor =
    netCashFlowMinor > 0 && receivedMinor > 0 && sentMinor > 0 ? netCashFlowMinor : null;

  const categoryBreakdown = buildCategoryBreakdown(current, previous);
  const days = Math.max(1, Math.ceil((resolved.end.getTime() - resolved.start.getTime()) / 86_400_000));
  const granularity: "day" | "week" | "month" = days <= 45 ? "day" : days <= 240 ? "week" : "month";

  const dailyStart = new Date(Math.max(resolved.start.getTime(), resolved.end.getTime() - 30 * 86_400_000));
  const weeklyStart = new Date(Math.max(resolved.start.getTime(), resolved.end.getTime() - 56 * 86_400_000));
  return {
    period: {
      start: resolved.start.toISOString(),
      end: resolved.end.toISOString(),
      label: resolved.label,
    },
    receivedMinor,
    sentMinor,
    expenseMinor,
    netCashFlowMinor,
    walletBalanceMinor,
    savingsEstimateMinor,
    transactionCount: current.length,
    categoryBreakdown,
    cashFlow: bucketize(current, resolved.start, resolved.end, granularity),
    weekly: bucketize(current, weeklyStart, resolved.end, "week"),
    daily: bucketize(current, dailyStart, resolved.end, "day"),
    insights: buildInsights(current, previous, categoryBreakdown, resolved.label),
    generatedAt: new Date().toISOString(),
  };
}

/** Underlying records for a category drill-down, scoped to the caller. */
export async function getCategoryTransactions(
  userId: string,
  categoryId: string,
  period: InsightPeriod,
  from?: string,
  to?: string,
  filters: { search?: string; minMinor?: number; maxMinor?: number; direction?: "SENT" | "RECEIVED" } = {},
) {
  const resolved = resolvePeriod(period, from, to);
  const enriched = await loadEnrichedTransactions(userId);
  return enriched
    .filter((record) => inRange(record, resolved.start, resolved.end))
    .filter((record) => record.categoryId === categoryId)
    .filter((record) => !filters.direction || record.direction === filters.direction)
    .filter((record) => filters.minMinor === undefined || Number(record.amountMinor) >= filters.minMinor)
    .filter((record) => filters.maxMinor === undefined || Number(record.amountMinor) <= filters.maxMinor)
    .filter((record) => {
      const needle = filters.search?.trim().toLowerCase();
      if (!needle) return true;
      return [record.counterpartyName, record.counterpartyUsername, record.description, record.paymentRef]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .map(toTransactionSummary);
}

export interface SpendingAnalytics {
  period: ResolvedPeriod;
  totalSpentMinor: number;
  previousTotalSpentMinor: number;
  changeMinor: number;
  changePercentage: number | null;
  transactionCount: number;
  categories: CategoryBreakdown[];
}

export async function getSpendingAnalytics(
  userId: string,
  period: InsightPeriod,
  from?: string,
  to?: string,
): Promise<SpendingAnalytics> {
  const resolved = resolvePeriod(period, from, to);
  const enriched = await loadEnrichedTransactions(userId);
  const current = enriched.filter(
    (record) => record.direction === "SENT" && SPENDING_CATEGORY_TYPES.includes(record.categoryType) && inRange(record, resolved.start, resolved.end),
  );
  const previous = enriched.filter(
    (record) => record.direction === "SENT" && SPENDING_CATEGORY_TYPES.includes(record.categoryType) && inRange(record, resolved.previousStart, resolved.previousEnd),
  );
  const total = sum(current);
  const previousTotal = sum(previous);
  return {
    period: resolved,
    totalSpentMinor: total,
    previousTotalSpentMinor: previousTotal,
    changeMinor: total - previousTotal,
    changePercentage: previousTotal === 0 ? null : Math.round(((total - previousTotal) / previousTotal) * 1000) / 10,
    transactionCount: current.length,
    categories: buildCategoryBreakdown(
      enriched.filter((record) => inRange(record, resolved.start, resolved.end)),
      enriched.filter((record) => inRange(record, resolved.previousStart, resolved.previousEnd)),
    ),
  };
}
