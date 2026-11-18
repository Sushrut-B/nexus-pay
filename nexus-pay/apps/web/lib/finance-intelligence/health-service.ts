import { prisma } from "@nexus/database";
import type { HealthScoreView } from "@nexus/shared-types";
import { loadClassifiedTransactions, moneyMovements } from "@/lib/finance-intelligence/classification-service";
import { listBudgets } from "@/lib/finance/budget-service";
import { listGoals } from "@/lib/finance/savings-service";

export const HEALTH_FORMULA =
  "Weighted mean of six 0–100 dimensions: budget adherence 20%, savings consistency 20%, cash-flow stability 15%, recurring commitment ratio 15%, spending volatility 15%, goal progress 15%. Unavailable when fewer than 10 monetary records or one month of history exist.";

const WEIGHTS: Record<string, number> = {
  BUDGET_ADHERENCE: 20,
  SAVINGS_CONSISTENCY: 20,
  CASH_FLOW_STABILITY: 15,
  RECURRING_COMMITMENT: 15,
  SPENDING_VOLATILITY: 15,
  GOAL_PROGRESS: 15,
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function computeHealthScore(userId: string): Promise<HealthScoreView> {
  const now = new Date();
  const since = new Date(now.getTime() - 180 * 86_400_000);
  const [current, previous, budgets, goals, patterns] = await Promise.all([
    loadClassifiedTransactions(userId, new Date(now.getTime() - 30 * 86_400_000), now),
    loadClassifiedTransactions(userId, since, new Date(now.getTime() - 30 * 86_400_000)),
    listBudgets(userId),
    listGoals(userId),
    prisma.recurringExpensePattern.findMany({ where: { userId, status: { in: ["CONFIRMED", "DETECTED"] } } }),
  ]);
  const records = [...current.records, ...previous.records].filter((record) => record.category !== "REWARD");
  const out = records.filter((record) => record.direction === "OUT" && !record.isAdjustment);
  const totals = moneyMovements(records);

  if (out.length < 10 || records.length < 10) {
    return {
      available: false, overallScore: null, dimensions: [], positiveFactors: [], improvements: [],
      computedAt: null,
      reason: "Insufficient persisted transaction history (fewer than 10 classified monetary records).",
      formula: HEALTH_FORMULA,
      notice: "This is a financial wellbeing indicator, not a credit score.",
    };
  }

  const budgetList = budgets.items ?? [];
  const avgUtilisation = budgetList.length
    ? budgetList.reduce((sum, budget) => sum + (budget.utilization ?? 0), 0) / budgetList.length
    : null;
  const budgetScore = avgUtilisation === null ? 60 : clamp(100 - Math.max(0, avgUtilisation - 80) * 2);

  const months = new Map<string, number>();
  for (const record of records) {
    const key = record.occurredAt.toISOString().slice(0, 7);
    const before = moneyMovements([record]).netMinor;
    months.set(key, (months.get(key) ?? 0) + before);
  }
  const nets = [...months.values()];
  const positiveMonths = nets.filter((value) => value > 0).length;
  const savingsScore = clamp((positiveMonths / Math.max(1, nets.length)) * 100);
  const meanNet = nets.reduce((sum, value) => sum + value, 0) / Math.max(1, nets.length);
  const variance = nets.reduce((sum, value) => sum + (value - meanNet) ** 2, 0) / Math.max(1, nets.length);
  const cv = meanNet === 0 ? 1 : Math.sqrt(variance) / Math.abs(meanNet);
  const stabilityScore = clamp(100 - cv * 40);

  const recurringMinor = patterns.reduce((sum, pattern) => sum + pattern.amountMinor, 0);
  const income = totals.inflowMinor;
  const commitmentRatio = income > 0 ? recurringMinor / income : 0;
  const recurringScore = income === 0 ? 60 : clamp(100 - commitmentRatio * 200);

  const meanSpend = out.reduce((sum, record) => sum + record.amountMinor, 0) / out.length;
  const spendVariance = out.reduce((sum, record) => sum + (record.amountMinor - meanSpend) ** 2, 0) / out.length;
  const spendCv = meanSpend === 0 ? 1 : Math.sqrt(spendVariance) / meanSpend;
  const volatilityScore = clamp(100 - spendCv * 50);

  const goalList = goals.items ?? [];
  const goalScore = goalList.length
    ? clamp(goalList.reduce((sum, goal) => sum + (goal.progress ?? 0), 0) / goalList.length)
    : 60;

  const values: Record<string, number> = {
    BUDGET_ADHERENCE: budgetScore,
    SAVINGS_CONSISTENCY: savingsScore,
    CASH_FLOW_STABILITY: stabilityScore,
    RECURRING_COMMITMENT: recurringScore,
    SPENDING_VOLATILITY: volatilityScore,
    GOAL_PROGRESS: goalScore,
  };
  const explanations: Record<string, string> = {
    BUDGET_ADHERENCE: avgUtilisation === null ? "No active budgets; neutral value applied." : `Average budget utilisation ${avgUtilisation.toFixed(1)}%.`,
    SAVINGS_CONSISTENCY: `${positiveMonths} of ${nets.length} observed months had positive net cash flow.`,
    CASH_FLOW_STABILITY: `Coefficient of variation of monthly net cash flow: ${cv.toFixed(2)}.`,
    RECURRING_COMMITMENT: income === 0 ? "No verified income; neutral value applied." : `Recurring commitments are ${(commitmentRatio * 100).toFixed(1)}% of verified inflow.`,
    SPENDING_VOLATILITY: `Transaction amount coefficient of variation: ${spendCv.toFixed(2)}.`,
    GOAL_PROGRESS: goalList.length ? `Average goal progress ${Math.round(goalList.reduce((sum, g) => sum + (g.progress ?? 0), 0) / goalList.length)}%.` : "No savings goals; neutral value applied.",
  };
  const overall = Math.round(
    Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + values[key]! * weight, 0) / 100,
  );

  const snapshot = await prisma.financialHealthSnapshot.create({
    data: {
      userId, overallScore: overall, availability: "AVAILABLE", computedAt: now,
      payload: { values, explanations } as object,
      dimensions: {
        create: Object.entries(WEIGHTS).map(([key, weight]) => ({
          key, score: values[key]!, weight, explanation: { text: explanations[key] },
        })),
      },
    },
    include: { dimensions: true },
  });

  return {
    available: true,
    overallScore: overall,
    dimensions: snapshot.dimensions.map((dimension) => ({
      key: dimension.key,
      score: dimension.score,
      weight: dimension.weight,
      explanation: (dimension.explanation as { text?: string }).text ?? explanations[dimension.key] ?? "",
    })),
    positiveFactors: Object.entries(values).filter(([, value]) => value >= 70).map(([key]) => explanations[key]!),
    improvements: Object.entries(values).filter(([, value]) => value < 50).map(([key]) => explanations[key]!),
    computedAt: snapshot.computedAt.toISOString(),
    reason: null,
    formula: HEALTH_FORMULA,
    notice: "This is a financial wellbeing indicator, not a credit score. It does not predict loan eligibility.",
  };
}

export async function healthHistory(userId: string, limit = 20): Promise<HealthScoreView[]> {
  const rows = await prisma.financialHealthSnapshot.findMany({
    where: { userId, availability: "AVAILABLE" },
    include: { dimensions: true },
    orderBy: { computedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => ({
    available: true,
    overallScore: row.overallScore,
    dimensions: row.dimensions.map((dimension) => ({
      key: dimension.key, score: dimension.score, weight: dimension.weight,
      explanation: (dimension.explanation as { text?: string }).text ?? "",
    })),
    positiveFactors: [], improvements: [],
    computedAt: row.computedAt.toISOString(), reason: null,
    formula: HEALTH_FORMULA,
    notice: "Not a credit score.",
  }));
}
