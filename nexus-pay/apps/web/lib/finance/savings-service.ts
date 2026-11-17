import { prisma, type SavingsGoal } from "@nexus/database";
import type {
  ContributionType,
  SavingsContributionView,
  SavingsGoalListResult,
  SavingsGoalStatus,
  SavingsGoalView,
} from "@nexus/shared-types";
import type { ContributionCreateInput, SavingsGoalCreateInput, SavingsGoalUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { createNotification } from "@/lib/social/shared";

const goalInclude = { contributions: { orderBy: { createdAt: "desc" } } } as const;

type GoalWithContributions = SavingsGoal & { contributions: Array<{
  id: string;
  amountMinor: bigint;
  contributionType: ContributionType;
  relatedPaymentRef: string | null;
  note: string | null;
  createdAt: Date;
}> };

function toContributionView(contribution: GoalWithContributions["contributions"][number]): SavingsContributionView {
  return {
    id: contribution.id,
    amountMinor: Number(contribution.amountMinor),
    contributionType: contribution.contributionType,
    relatedPaymentRef: contribution.relatedPaymentRef,
    note: contribution.note,
    createdAt: contribution.createdAt.toISOString(),
  };
}

function toView(goal: GoalWithContributions): SavingsGoalView {
  const recorded = goal.contributions
    .filter((contribution) => contribution.contributionType === "RECORDED")
    .reduce((sum, contribution) => sum + Number(contribution.amountMinor), 0);
  const planned = goal.contributions
    .filter((contribution) => contribution.contributionType === "PLANNED")
    .reduce((sum, contribution) => sum + Number(contribution.amountMinor), 0);
  const target = Number(goal.targetAmountMinor);
  const progress = target === 0 ? 0 : Math.min(100, Math.round((recorded / target) * 1000) / 10);
  return {
    id: goal.id,
    name: goal.name,
    targetAmountMinor: target,
    currency: goal.currency,
    targetDate: goal.targetDate?.toISOString() ?? null,
    description: goal.description,
    icon: goal.icon,
    status: goal.status,
    recordedMinor: recorded,
    plannedMinor: planned,
    remainingMinor: Math.max(0, target - recorded),
    progress,
    contributions: goal.contributions.map(toContributionView),
  };
}

/**
 * Savings goals are planning/tracking records. Contributions are explicit
 * planning events and never move wallet money or touch Raftline.
 */
export async function createGoal(userId: string, input: SavingsGoalCreateInput): Promise<SavingsGoalView> {
  const goal = await prisma.savingsGoal.create({
    data: {
      userId,
      name: input.name,
      targetAmountMinor: BigInt(input.targetAmountMinor),
      currency: input.currency,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      description: input.description ?? null,
      icon: input.icon ?? null,
    },
    include: goalInclude,
  });
  return toView(goal as GoalWithContributions);
}

export async function listGoals(userId: string): Promise<SavingsGoalListResult> {
  const goals = await prisma.savingsGoal.findMany({
    where: { userId },
    include: goalInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  const items = (goals as GoalWithContributions[]).map(toView);
  return { items, total: items.length };
}

export async function getGoal(userId: string, goalId: string): Promise<SavingsGoalView> {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, include: goalInclude });
  if (!goal) throw new ApiError(404, "AUTHORIZATION_ERROR", "That savings goal could not be found.");
  return toView(goal as GoalWithContributions);
}

export async function updateGoal(
  userId: string,
  goalId: string,
  input: SavingsGoalUpdateInput,
): Promise<SavingsGoalView> {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, include: goalInclude });
  if (!goal) throw new ApiError(404, "AUTHORIZATION_ERROR", "That savings goal could not be found.");

  const recorded = goal.contributions
    .filter((contribution) => contribution.contributionType === "RECORDED")
    .reduce((sum, contribution) => sum + Number(contribution.amountMinor), 0);
  const target = input.targetAmountMinor ?? Number(goal.targetAmountMinor);

  let status = input.status ?? goal.status;
  if (status === "ACTIVE" && recorded >= target && target > 0) {
    status = "COMPLETED";
  }

  const updated = await prisma.savingsGoal.update({
    where: { id: goalId },
    data: {
      name: input.name,
      targetAmountMinor: input.targetAmountMinor === undefined ? undefined : BigInt(input.targetAmountMinor),
      targetDate:
        input.targetDate === null
          ? null
          : input.targetDate
            ? new Date(input.targetDate)
            : undefined,
      description: input.description === null ? null : input.description,
      icon: input.icon === null ? null : input.icon,
      status: status as SavingsGoalStatus,
    },
    include: goalInclude,
  });

  if (status === "COMPLETED" && goal.status !== "COMPLETED") {
    await createNotification(prisma, {
      userId,
      type: "SAVINGS_GOAL_COMPLETED",
      title: "Savings goal completed",
      body: `${updated.name} reached its target.`,
      data: { goalId: updated.id },
    });
  }
  return toView(updated as GoalWithContributions);
}

export async function deleteGoal(userId: string, goalId: string): Promise<void> {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, include: goalInclude });
  if (!goal) throw new ApiError(404, "AUTHORIZATION_ERROR", "That savings goal could not be found.");
  const recorded = goal.contributions
    .filter((contribution) => contribution.contributionType === "RECORDED")
    .reduce((sum, contribution) => sum + Number(contribution.amountMinor), 0);
  if (recorded > 0 && goal.status !== "CANCELLED") {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "This goal already has recorded contributions. Cancel it instead of deleting the history.",
    );
  }
  await prisma.savingsGoal.delete({ where: { id: goalId } });
}

export async function addContribution(
  userId: string,
  goalId: string,
  input: ContributionCreateInput,
): Promise<SavingsGoalView> {
  const goal = await prisma.savingsGoal.findFirst({ where: { id: goalId, userId }, include: goalInclude });
  if (!goal) throw new ApiError(404, "AUTHORIZATION_ERROR", "That savings goal could not be found.");
  if (goal.status === "COMPLETED" || goal.status === "CANCELLED") {
    throw new ApiError(409, "PAYMENT_ERROR", "This goal is no longer active.");
  }
  if (input.relatedPaymentRef) {
    const payment = await prisma.transactionRecord.findFirst({
      where: { userId, paymentRef: input.relatedPaymentRef, status: "SUCCESSFUL" },
    });
    if (!payment) {
      throw new ApiError(400, "PAYMENT_ERROR", "The linked payment could not be verified.");
    }
  }

  await prisma.savingsContribution.create({
    data: {
      goalId,
      amountMinor: BigInt(input.amountMinor),
      contributionType: input.contributionType,
      relatedPaymentRef: input.relatedPaymentRef ?? null,
      note: input.note ?? null,
    },
  });

  const refreshed = await prisma.savingsGoal.findFirstOrThrow({ where: { id: goalId }, include: goalInclude });
  const recorded = refreshed.contributions
    .filter((contribution) => contribution.contributionType === "RECORDED")
    .reduce((sum, contribution) => sum + Number(contribution.amountMinor), 0);

  let status = refreshed.status;
  if (status === "ACTIVE" && recorded >= Number(refreshed.targetAmountMinor) && Number(refreshed.targetAmountMinor) > 0) {
    status = "COMPLETED";
    await prisma.savingsGoal.update({ where: { id: goalId }, data: { status: "COMPLETED" } });
    await createNotification(prisma, {
      userId,
      type: "SAVINGS_GOAL_COMPLETED",
      title: "Savings goal completed",
      body: `${refreshed.name} reached its target.`,
      data: { goalId },
    });
  }

  const final = await prisma.savingsGoal.findFirstOrThrow({ where: { id: goalId }, include: goalInclude });
  return toView(final as GoalWithContributions);
}
