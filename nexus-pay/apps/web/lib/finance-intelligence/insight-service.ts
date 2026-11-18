import { prisma } from "@nexus/database";
import type { AnomalyStatus, InsightStatus } from "@nexus/database";
import type { BudgetRecommendationView, SpendingInsightView } from "@nexus/shared-types";
import type { InsightFeedbackInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";
import { createBudget } from "@/lib/finance/budget-service";
import { listCategories } from "@/lib/finance/category-service";
import { getCategorySpend } from "@/lib/finance-intelligence/aggregation-service";

function insightView(row: {
  id: string; title: string; body: string; kind: string; severity: string; status: InsightStatus; createdAt: Date;
}): SpendingInsightView {
  return {
    id: row.id, title: row.title, body: row.body, kind: row.kind,
    severity: row.severity, status: row.status, createdAt: row.createdAt.toISOString(),
  };
}

export async function generateInsights(userId: string): Promise<SpendingInsightView[]> {
  const categories = await getCategorySpend(userId, "month");
  const total = categories.reduce((sum, category) => sum + category.amountMinor, 0);
  const candidates: Array<{ kind: string; title: string; body: string; severity: string }> = [];

  if (categories.length === 0) {
    candidates.push({
      kind: "INSUFFICIENT_DATA",
      title: "More data will improve your insights",
      body: "Once you have recorded spending, this area will show category trends and practical observations.",
      severity: "info",
    });
  } else {
    const top = categories.slice(0, 3);
    const share = total > 0 ? Math.round((top.reduce((sum, c) => sum + c.amountMinor, 0) / total) * 100) : 0;
    candidates.push({
      kind: "TOP_CATEGORIES",
      title: "Your largest categories",
      body: `${top.map((c) => c.category.replaceAll("_", " ").toLowerCase()).join(", ")} account for ${share}% of recorded expenses.`,
      severity: "info",
    });
    const fastest = categories.find((category) => category.changeBps !== null && category.changeBps > 1500);
    if (fastest) {
      candidates.push({
        kind: "CATEGORY_INCREASE",
        title: `${fastest.category.replaceAll("_", " ")} increased`,
        body: `Spending is ${(fastest.changeBps! / 100).toFixed(0)}% higher than the previous equivalent period. Review the transactions to understand what changed.`,
        severity: "warning",
      });
    }
  }
  const patterns = await prisma.recurringExpensePattern.count({ where: { userId, status: "DETECTED" } });
  if (patterns > 0) {
    candidates.push({
      kind: "RECURRING_DETECTED",
      title: "Potential recurring expenses found",
      body: `${patterns} spending pattern${patterns === 1 ? "" : "s"} look recurring. Confirm them to track future commitments.`,
      severity: "info",
    });
  }
  const anomalies = await prisma.spendingAnomaly.count({ where: { userId, status: "OPEN" as AnomalyStatus } });
  if (anomalies > 0) {
    candidates.push({
      kind: "ANOMALIES",
      title: "Unusual spending to review",
      body: `${anomalies} transaction${anomalies === 1 ? "" : "s"} differ from your usual baseline. This is informational, not a fraud finding.`,
      severity: "warning",
    });
  }

  const created: SpendingInsightView[] = [];
  for (const candidate of candidates) {
    const row = await prisma.financialInsight.upsert({
      where: { userId_kind_title: { userId, kind: candidate.kind, title: candidate.title } },
      create: {
        userId, kind: candidate.kind, title: candidate.title, body: candidate.body,
        severity: candidate.severity, data: {}, status: "ACTIVE",
      },
      update: { body: candidate.body, status: "ACTIVE" },
    });
    created.push(insightView(row));
    await createNotification(prisma, {
      userId,
      type: "FINANCE_INSIGHT_AVAILABLE",
      title: candidate.title,
      body: candidate.body.slice(0, 400),
      data: { insightId: row.id },
    });
  }
  return created;
}

export async function listInsights(userId: string, status?: InsightStatus): Promise<SpendingInsightView[]> {
  const rows = await prisma.financialInsight.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map(insightView);
}

export async function feedbackInsight(userId: string, id: string, input: InsightFeedbackInput): Promise<SpendingInsightView> {
  const insight = await prisma.financialInsight.findFirst({ where: { id, userId } });
  if (!insight) throw new ApiError(404, "AUTHORIZATION_ERROR", "Insight not found.");
  await prisma.financialInsightFeedback.upsert({
    where: { insightId_userId: { insightId: id, userId } },
    create: { insightId: id, userId, useful: input.useful, note: input.note ?? null },
    update: { useful: input.useful, note: input.note ?? null },
  });
  const updated = await prisma.financialInsight.update({
    where: { id },
    data: { status: input.useful ? "USEFUL" : "DISMISSED" },
  });
  return insightView(updated);
}

export async function generateBudgetRecommendations(userId: string): Promise<BudgetRecommendationView[]> {
  const categories = await getCategorySpend(userId, "month");
  const created: BudgetRecommendationView[] = [];
  for (const category of categories.slice(0, 8)) {
    const suggested = Math.max(1000, Math.round((category.amountMinor * 0.9) / 100) * 100);
    const row = await prisma.budgetRecommendation.upsert({
      where: { userId_category: { userId, category: category.category } },
      create: {
        userId, category: category.category, suggestedMinor: suggested,
        historicalAverageMinor: category.amountMinor,
        reason: `Based on your recorded spending with a 10% reduction target.`,
        confidence: category.changeBps === null ? "LOW" : "MEDIUM",
        status: "SUGGESTED",
      },
      update: {
        suggestedMinor: suggested, historicalAverageMinor: category.amountMinor,
        confidence: category.changeBps === null ? "LOW" : "MEDIUM", status: "SUGGESTED",
      },
    });
    created.push({
      id: row.id, category: row.category, suggestedMinor: row.suggestedMinor,
      historicalAverageMinor: row.historicalAverageMinor, reason: row.reason,
      confidence: row.confidence, status: row.status, createdAt: row.createdAt.toISOString(),
    });
  }
  return created;
}

export async function listBudgetRecommendations(userId: string): Promise<BudgetRecommendationView[]> {
  const rows = await prisma.budgetRecommendation.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return rows.map((row) => ({
    id: row.id, category: row.category, suggestedMinor: row.suggestedMinor,
    historicalAverageMinor: row.historicalAverageMinor, reason: row.reason,
    confidence: row.confidence, status: row.status, createdAt: row.createdAt.toISOString(),
  }));
}

export async function decideBudgetRecommendation(userId: string, id: string, approve: boolean) {
  const row = await prisma.budgetRecommendation.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Recommendation not found.");
  if (row.status !== "SUGGESTED") throw new ApiError(409, "PAYMENT_ERROR", "This recommendation was already decided.");
  let budgetId: string | null = null;
  if (approve) {
    const categories = await listCategories(userId);
    const match =
      categories.find((category) => category.name.toUpperCase() === row.category) ??
      categories.find((category) => category.name === "OTHER") ??
      categories[0];
    if (!match) throw new ApiError(409, "PAYMENT_ERROR", "No transaction category is available for this budget.");
    const budget = await createBudget(userId, {
      name: `${row.category.replaceAll("_", " ")} plan`,
      categoryId: match.id,
      amountMinor: row.suggestedMinor,
      currency: "INR",
      periodType: "MONTHLY",
      startDate: new Date().toISOString().slice(0, 10),
      thresholds: [50, 75, 90, 100],
    });
    budgetId = budget.id;
  }
  return prisma.budgetRecommendation.update({
    where: { id },
    data: { status: approve ? "APPROVED" : "REJECTED", budgetId },
  });
}
