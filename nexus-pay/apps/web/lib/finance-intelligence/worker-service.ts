import { prisma } from "@nexus/database";
import type { FinancialPreferenceView, FinanceOperationsView } from "@nexus/shared-types";
import type { FinancePreferenceUpdateInput } from "@nexus/validation";
import { persistSnapshot } from "@/lib/finance-intelligence/aggregation-service";
import { detectRecurringPatterns } from "@/lib/finance-intelligence/recurring-service";
import { generateForecast } from "@/lib/finance-intelligence/forecast-service";
import { detectAnomalies } from "@/lib/finance-intelligence/anomaly-service";
import { computeHealthScore } from "@/lib/finance-intelligence/health-service";
import { generateInsights, generateBudgetRecommendations } from "@/lib/finance-intelligence/insight-service";
import { runReportWorker } from "@/lib/finance-intelligence/report-service";

export async function getPreferences(userId: string): Promise<FinancialPreferenceView> {
  const row = await prisma.financialPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return {
    defaultPeriod: row.defaultPeriod,
    timezone: row.timezone,
    insightNotifications: row.insightNotifications,
    forecastNotifications: row.forecastNotifications,
    budgetRecommendationNotifications: row.budgetRecommendationNotifications,
    recurringDetection: row.recurringDetection,
    goalReminders: row.goalReminders,
  };
}

export async function updatePreferences(userId: string, input: FinancePreferenceUpdateInput): Promise<FinancialPreferenceView> {
  await prisma.financialPreference.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return getPreferences(userId);
}

export interface FinanceWorkerResult {
  users: number;
  snapshots: number;
  recurring: number;
  forecasts: number;
  anomalies: number;
  insights: number;
  healthScores: number;
  recommendations: number;
  reports: number;
  errors: number;
}

/** One finance intelligence pass over users with recent financial activity. */
export async function runFinanceWorker(): Promise<FinanceWorkerResult> {
  const result: FinanceWorkerResult = {
    users: 0, snapshots: 0, recurring: 0, forecasts: 0, anomalies: 0,
    insights: 0, healthScores: 0, recommendations: 0, reports: 0, errors: 0,
  };
  const since = new Date(Date.now() - 30 * 86_400_000);
  const active = await prisma.transactionRecord.findMany({
    where: { occurredAt: { gte: since } },
    select: { userId: true },
    distinct: ["userId"],
    take: 25,
  });
  const withGoals = await prisma.savingsGoal.findMany({ where: { status: "ACTIVE" }, select: { userId: true }, distinct: ["userId"], take: 25 });
  const withSubscriptions = await prisma.subscription.findMany({ where: { status: "ACTIVE" }, select: { customerUserId: true }, distinct: ["customerUserId"], take: 25 });
  const userIds = [
    ...new Set([
      ...active.map((row) => row.userId),
      ...withGoals.map((row) => row.userId),
      ...withSubscriptions.map((row) => row.customerUserId),
    ]),
  ].slice(0, 50);
  result.users = userIds.length;

  for (const userId of userIds) {
    try {
      const preference = await prisma.financialPreference.findUnique({ where: { userId } });
      await Promise.all([
        persistSnapshot(userId, "month", "CASH_FLOW").then(() => { result.snapshots += 1; }),
        generateForecast(userId, "MONTHLY_EXPENSE", "month").then(() => { result.forecasts += 1; }),
        detectAnomalies(userId).then((rows) => { result.anomalies += rows.length; }),
        computeHealthScore(userId).then(() => { result.healthScores += 1; }),
        generateBudgetRecommendations(userId).then((rows) => { result.recommendations += rows.length; }),
      ]);
      if (preference?.recurringDetection !== false) {
        const patterns = await detectRecurringPatterns(userId);
        result.recurring += patterns.length;
      }
      const insights = await generateInsights(userId);
      result.insights += insights.length;
    } catch {
      result.errors += 1;
    }
  }
  result.reports = await runReportWorker(10);
  return result;
}

export async function getFinanceOperations(): Promise<FinanceOperationsView> {
  const [snapshots, forecasts, anomalies, insights, failedReports, qualityIssues, backlog, lastSnapshot] = await Promise.all([
    prisma.financialAggregationSnapshot.count(),
    prisma.financialForecast.count(),
    prisma.spendingAnomaly.count({ where: { status: "OPEN" } }),
    prisma.financialInsight.count({ where: { status: "ACTIVE" } }),
    prisma.financialReportJob.count({ where: { status: "DEAD_LETTER" } }),
    prisma.financialDataQualityEvent.count({ where: { status: "OPEN" } }),
    prisma.financialReportJob.count({ where: { status: "PENDING" } }),
    prisma.financialAggregationSnapshot.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  return {
    snapshots, forecasts, anomalies, insights, failedReports, dataQualityIssues: qualityIssues,
    processingBacklog: backlog,
    reconciliationFailures: await prisma.financialDataQualityEvent.count({
      where: { status: "OPEN", issueCode: { contains: "RECONCILIATION" } },
    }),
    lastWorkerRun: lastSnapshot?.updatedAt.toISOString() ?? null,
    currency: "INR",
  };
}
