import { prisma } from "@nexus/database";
import type { GoalView } from "@nexus/shared-types";
import type { SavingsGoalCreateInput, ContributionCreateInput } from "@nexus/validation";
import { createGoal, addContribution } from "@/lib/finance/savings-service";

function toView(row: {
  id: string; name: string; targetAmountMinor: bigint; targetDate: Date | null;
  priority: string; status: string; currency: string;
  contributions: Array<{ amountMinor: bigint; contributionType: string }>;
}): GoalView {
  const planned = row.contributions
    .filter((c) => c.contributionType === "PLANNED")
    .reduce((sum, c) => sum + Number(c.amountMinor), 0);
  const recorded = row.contributions
    .filter((c) => c.contributionType === "RECORDED")
    .reduce((sum, c) => sum + Number(c.amountMinor), 0);
  const target = Number(row.targetAmountMinor);
  const progress = target > 0 ? Math.min(10_000, Math.round(((recorded + planned) / target) * 10_000)) : 0;
  const monthlyNeed = row.targetDate
    ? Math.max(1, Math.ceil((target - recorded - planned) / Math.max(1, Math.ceil((row.targetDate.getTime() - Date.now()) / (30 * 86_400_000)))))
    : 0;
  const estimatedCompletionDate = monthlyNeed > 0 && recorded + planned < target
    ? new Date(Date.now() + Math.ceil((target - recorded - planned) / monthlyNeed) * 30 * 86_400_000).toISOString()
    : recorded + planned >= target ? new Date().toISOString() : null;
  return {
    id: row.id, name: row.name, targetMinor: target, plannedMinor: planned, recordedMinor: recorded,
    progressBps: progress, targetDate: row.targetDate?.toISOString() ?? null, priority: row.priority,
    status: row.status, estimatedCompletionDate, contributionCount: row.contributions.length,
    currency: row.currency,
  };
}

export async function listFinancialGoals(userId: string): Promise<GoalView[]> {
  const goals = await prisma.savingsGoal.findMany({
    where: { userId },
    include: { contributions: true },
    orderBy: { createdAt: "desc" },
  });
  return goals.map(toView);
}

export async function createFinancialGoal(userId: string, input: SavingsGoalCreateInput): Promise<GoalView> {
  const created = await createGoal(userId, input);
  const row = await prisma.savingsGoal.findUniqueOrThrow({
    where: { id: created.id },
    include: { contributions: true },
  });
  return toView(row);
}

export async function addGoalContribution(userId: string, goalId: string, input: ContributionCreateInput): Promise<GoalView> {
  await addContribution(userId, goalId, input);
  const row = await prisma.savingsGoal.findUniqueOrThrow({
    where: { id: goalId, userId },
    include: { contributions: true },
  });
  return toView(row);
}

