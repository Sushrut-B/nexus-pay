import { prisma } from "@nexus/database";
import type { FinancePeriod, ForecastView } from "@nexus/shared-types";
import { loadClassifiedTransactions } from "@/lib/finance-intelligence/classification-service";
import { resolveFinancePeriod } from "@/lib/finance-intelligence/aggregation-service";

const MIN_HISTORY = 6;

function persistView(row: {
  id: string; kind: string; periodStart: Date; periodEnd: Date; predictedMinor: number;
  lowMinor: number; highMinor: number; method: string; assumptions: unknown; historyCount: number;
}): ForecastView {
  return {
    id: row.id,
    kind: row.kind,
    predictedMinor: row.predictedMinor,
    lowMinor: row.lowMinor,
    highMinor: row.highMinor,
    method: row.method,
    assumptions: (row.assumptions as { list?: string[] }).list ?? [],
    historyCount: row.historyCount,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    available: true,
    reason: null,
    currency: "INR",
  };
}

/** Transparent rolling-average forecast with an explicit uncertainty band. */
export async function generateForecast(
  userId: string,
  kind: "MONTHLY_EXPENSE" | "MONTH_END_BALANCE" | "MONTHLY_INCOME" = "MONTHLY_EXPENSE",
  period: FinancePeriod = "month",
  from?: string,
  to?: string,
): Promise<ForecastView> {
  const window = resolveFinancePeriod(period, from, to);
  const history = await loadClassifiedTransactions(userId, new Date(Date.now() - 180 * 86_400_000), window.to);
  const relevant = history.records.filter((record) => {
    if (kind === "MONTHLY_EXPENSE") return record.direction === "OUT" && !record.isAdjustment;
    return record.direction === "IN" && !record.isAdjustment;
  });
  const historyCount = relevant.length;

  if (historyCount < MIN_HISTORY) {
    return {
      id: null, kind, predictedMinor: 0, lowMinor: 0, highMinor: 0,
      method: "NONE", assumptions: [], historyCount,
      periodStart: window.to.toISOString(),
      periodEnd: new Date(window.to.getTime() + 30 * 86_400_000).toISOString(),
      available: false,
      reason: `Insufficient historical data: ${historyCount} records, at least ${MIN_HISTORY} required.`,
      currency: "INR",
    };
  }

  const buckets = new Map<string, number>();
  for (const record of relevant) {
    const key = record.occurredAt.toISOString().slice(0, 7);
    buckets.set(key, (buckets.get(key) ?? 0) + record.amountMinor);
  }
  const monthlyTotals = [...buckets.values()].slice(-3);
  const predicted = Math.round(monthlyTotals.reduce((sum, value) => sum + value, 0) / monthlyTotals.length);
  const spread = Math.round(predicted * 0.3);
  const assumptions = [
    `Rolling average of the last ${monthlyTotals.length} complete months.`,
    "No future income or spending events are assumed beyond known scheduled items.",
    "Uncertainty band is ±30% of the prediction, not a guarantee.",
    "All calculations use integer paise and UTC dates.",
  ];
  const created = await prisma.financialForecast.create({
    data: {
      userId, kind,
      periodStart: window.to,
      periodEnd: new Date(window.to.getTime() + 30 * 86_400_000),
      predictedMinor: predicted,
      lowMinor: Math.max(0, predicted - spread),
      highMinor: predicted + spread,
      method: "rolling_average_3m",
      assumptions: { list: assumptions },
      historyCount,
    },
  });
  return persistView(created);
}

export async function listForecasts(userId: string, limit = 20): Promise<ForecastView[]> {
  const rows = await prisma.financialForecast.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(persistView);
}

export async function getForecastSummary(userId: string): Promise<ForecastView> {
  return generateForecast(userId, "MONTHLY_EXPENSE", "month");
}
