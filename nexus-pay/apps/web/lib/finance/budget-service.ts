import { prisma, type Budget } from "@nexus/database";
import type { BudgetListResult, BudgetStatus, BudgetView, CategoryType } from "@nexus/shared-types";
import type { BudgetCreateInput, BudgetUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getCategoryOrThrow, toCategoryView } from "@/lib/finance/category-service";
import { createNotification } from "@/lib/social/shared";

interface BudgetCategory {
  id: string;
  userId: string | null;
  name: string;
  categoryType: CategoryType;
  icon: string | null;
  isSystem: boolean;
  createdAt: Date;
}

type BudgetWithCategory = Budget & { category: BudgetCategory };

const budgetInclude = { category: true } as const;

export interface BudgetPeriod {
  start: Date;
  end: Date;
}

/** Current budget period boundary based on its period type. */
export function currentBudgetPeriod(budget: Budget): BudgetPeriod {
  const now = new Date();
  let start: Date;
  let end: Date;

  if (budget.periodType === "WEEKLY") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dow = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - ((dow + 6) % 7));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (budget.periodType === "CUSTOM") {
    start = new Date(budget.startDate);
    end = budget.endDate ? new Date(budget.endDate) : new Date(start.getTime() + 30 * 86_400_000);
  } else {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  if (start < new Date(budget.startDate)) start = new Date(budget.startDate);
  if (budget.endDate && end > new Date(budget.endDate)) end = new Date(budget.endDate);
  return { start, end };
}

async function spendingInPeriod(userId: string, categoryId: string, start: Date, end: Date) {
  const records = await prisma.transactionRecord.findMany({
    where: {
      userId,
      status: "SUCCESSFUL",
      kind: "P2P",
      direction: "SENT",
      occurredAt: { gte: start, lt: end },
      paymentRef: { not: null },
    },
    select: { paymentRef: true, amountMinor: true },
  });

  const categorizations = await prisma.transactionCategorization.findMany({
    where: { userId, paymentRef: { in: records.map((r) => r.paymentRef!) }, categoryId },
    select: { paymentRef: true },
  });
  const matching = new Set(categorizations.map((row) => row.paymentRef));
  const matched = records.filter((record) => matching.has(record.paymentRef!));
  return {
    spentMinor: matched.reduce((sum, record) => sum + Number(record.amountMinor), 0),
    transactionCount: matched.length,
  };
}

function toView(budget: BudgetWithCategory, spentMinor: number, transactionCount: number, crossed: number[]): BudgetView {
  const utilization = budget.amountMinor === 0n ? 0 : Math.round((spentMinor / Number(budget.amountMinor)) * 1000) / 10;
  return {
    id: budget.id,
    name: budget.name,
    category: toCategoryView(budget.category),
    amountMinor: Number(budget.amountMinor),
    currency: budget.currency,
    periodType: budget.periodType,
    startDate: budget.startDate.toISOString(),
    endDate: budget.endDate?.toISOString() ?? null,
    status: budget.status,
    spentMinor,
    remainingMinor: Math.max(0, Number(budget.amountMinor) - spentMinor),
    utilization,
    transactionCount,
    crossedThresholds: crossed,
  };
}

/**
 * Record threshold crossings once per (budget, period, threshold) and notify.
 * Reopening the dashboard never re-notifies.
 */
export async function syncBudgetAlerts(userId: string, budget: BudgetWithCategory, utilization: number, period: BudgetPeriod): Promise<number[]> {
  const crossed = budget.thresholds.filter((threshold) => utilization >= threshold);
  const newlyCrossed: number[] = [];

  for (const threshold of crossed) {
    const existing = await prisma.budgetAlert.findUnique({
      where: {
        budgetId_periodStart_thresholdPercentage: {
          budgetId: budget.id,
          periodStart: period.start,
          thresholdPercentage: threshold,
        },
      },
    });
    if (existing) continue;
    await prisma.budgetAlert.create({
      data: { budgetId: budget.id, periodStart: period.start, thresholdPercentage: threshold },
    });
    newlyCrossed.push(threshold);
    await createNotification(prisma, {
      userId,
      type: threshold >= 100 ? "BUDGET_EXCEEDED" : "BUDGET_THRESHOLD_REACHED",
      title: threshold >= 100 ? "Budget exceeded" : `Budget ${threshold}% reached`,
      body: `${budget.name} has used ${Math.round(utilization)}% of its ${budget.currency} budget.`,
      data: { budgetId: budget.id, threshold },
    });
  }
  return newlyCrossed;
}

export async function createBudget(userId: string, input: BudgetCreateInput): Promise<BudgetView> {
  await getCategoryOrThrow(input.categoryId, userId);
  const budget = await prisma.budget.create({
    data: {
      userId,
      name: input.name,
      categoryId: input.categoryId,
      amountMinor: BigInt(input.amountMinor),
      currency: input.currency,
      periodType: input.periodType,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : null,
      thresholds: input.thresholds,
    },
    include: budgetInclude,
  });
  const period = currentBudgetPeriod(budget);
  const { spentMinor, transactionCount } = await spendingInPeriod(userId, budget.categoryId, period.start, period.end);
  return toView(budget as BudgetWithCategory, spentMinor, transactionCount, []);
}

export async function listBudgets(userId: string): Promise<BudgetListResult> {
  const budgets = await prisma.budget.findMany({
    where: { userId },
    include: budgetInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const items: BudgetView[] = [];
  for (const budget of budgets) {
    const period = currentBudgetPeriod(budget);
    const { spentMinor, transactionCount } = await spendingInPeriod(userId, budget.categoryId, period.start, period.end);
    const utilization = budget.amountMinor === 0n ? 0 : Math.round((spentMinor / Number(budget.amountMinor)) * 1000) / 10;
    const crossed = budget.status === "ACTIVE" ? await syncBudgetAlerts(userId, budget as BudgetWithCategory, utilization, period) : [];
    items.push(toView(budget as BudgetWithCategory, spentMinor, transactionCount, crossed));
  }
  return { items, total: items.length };
}

export async function getBudget(userId: string, budgetId: string): Promise<BudgetView> {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId }, include: budgetInclude });
  if (!budget) throw new ApiError(404, "AUTHORIZATION_ERROR", "That budget could not be found.");
  const period = currentBudgetPeriod(budget);
  const { spentMinor, transactionCount } = await spendingInPeriod(userId, budget.categoryId, period.start, period.end);
  const utilization = budget.amountMinor === 0n ? 0 : Math.round((spentMinor / Number(budget.amountMinor)) * 1000) / 10;
  const crossed = budget.status === "ACTIVE" ? await syncBudgetAlerts(userId, budget as BudgetWithCategory, utilization, period) : [];
  return toView(budget as BudgetWithCategory, spentMinor, transactionCount, crossed);
}

export async function updateBudget(
  userId: string,
  budgetId: string,
  input: BudgetUpdateInput,
): Promise<BudgetView> {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId }, include: budgetInclude });
  if (!budget) throw new ApiError(404, "AUTHORIZATION_ERROR", "That budget could not be found.");
  if (input.categoryId) await getCategoryOrThrow(input.categoryId, userId);

  const updated = await prisma.budget.update({
    where: { id: budgetId },
    data: {
      name: input.name,
      categoryId: input.categoryId,
      amountMinor: input.amountMinor === undefined ? undefined : BigInt(input.amountMinor),
      periodType: input.periodType,
      startDate: input.startDate ? new Date(`${input.startDate}T00:00:00.000Z`) : undefined,
      endDate: input.endDate === null ? null : input.endDate ? new Date(`${input.endDate}T23:59:59.999Z`) : undefined,
      status: input.status as BudgetStatus | undefined,
      thresholds: input.thresholds,
    },
    include: budgetInclude,
  });
  const period = currentBudgetPeriod(updated);
  const { spentMinor, transactionCount } = await spendingInPeriod(userId, updated.categoryId, period.start, period.end);
  return toView(updated as BudgetWithCategory, spentMinor, transactionCount, []);
}

export async function deleteBudget(userId: string, budgetId: string): Promise<void> {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, userId } });
  if (!budget) throw new ApiError(404, "AUTHORIZATION_ERROR", "That budget could not be found.");
  await prisma.budget.delete({ where: { id: budgetId } });
}
