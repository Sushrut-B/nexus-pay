import { prisma } from "@nexus/database";
import type { SipView, SipProjection, InvestmentGoalView } from "@nexus/shared-types";
import type { SipCalculatorInput, InvestmentGoalInput, GoalContributionInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { createNotification } from "@/lib/social/shared";

/** Pure hypothetical projection using integer minor units and integer basis points. */
export function calculateSipProjection(input: SipCalculatorInput): SipProjection {
  const monthlyRate = input.assumedReturnBps / 12 / 10_000;
  let value = 0;
  let invested = 0;
  const years: SipProjection["years"] = [];
  const contribution = input.frequency === "ANNUAL" ? input.monthlyMinor * 12 : input.monthlyMinor;
  const periods = input.frequency === "ANNUAL" ? Math.ceil(input.months / 12) : input.months;
  for (let period = 1; period <= periods; period += 1) {
    invested += contribution;
    value = Math.round(value * (1 + monthlyRate)) + contribution;
    if (period % 12 === 0 || period === periods) {
      years.push({
        year: Math.ceil(period / 12),
        investedMinor: invested,
        estimatedValueMinor: value,
      });
    }
  }
  return {
    monthlyMinor: input.monthlyMinor, months: input.months,
    assumedReturnBps: input.assumedReturnBps,
    totalInvestedMinor: invested,
    estimatedReturnsMinor: Math.max(0, value - invested),
    estimatedMaturityMinor: value,
    years,
    notice: "Hypothetical estimate based only on the assumptions you selected. Returns are not guaranteed and this is not an SIP mandate or investment advice.",
  };
}

export async function savePlan(userId: string, input: SipCalculatorInput, projection: SipProjection) {
  return prisma.investmentPlan.create({
    data: {
      userId, name: "SIP projection", kind: "SIP_PLANNER",
      input: input as object, projection: projection as object, isExecution: false,
    },
  });
}

export async function listPlans(userId: string) {
  return prisma.investmentPlan.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function listSips(userId: string): Promise<SipView[]> {
  const rows = await prisma.sIPTrackingRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => ({
    id: row.id, schemeCode: row.schemeCode, schemeName: row.schemeName, amountMinor: row.amountMinor,
    frequency: row.frequency, nextInstalmentDate: row.nextInstalmentDate?.toISOString() ?? null,
    instalmentsCompleted: row.instalmentsCompleted, investedMinor: row.investedMinor,
    currentValueMinor: row.currentValueMinor, status: row.status, source: row.source,
    providerReportedAt: row.providerReportedAt.toISOString(), isSandbox: true,
  }));
}

export async function updateSipStatus(userId: string, id: string, status: "ACTIVE" | "PAUSED" | "CANCELLED") {
  const row = await prisma.sIPTrackingRecord.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "SIP record not found.");
  return prisma.sIPTrackingRecord.update({ where: { id }, data: { status } });
}

function goalView(row: {
  id: string; name: string; goalType: string; targetAmountMinor: number;
  targetDate: Date | null; currentAmountMinor: number; monthlyTargetMinor: number | null;
  status: string; notes: string | null;
}): InvestmentGoalView {
  const remaining = Math.max(0, row.targetAmountMinor - row.currentAmountMinor);
  const months = row.targetDate ? Math.max(1, Math.ceil((row.targetDate.getTime() - Date.now()) / (30 * 86_400_000))) : 60;
  return {
    id: row.id, name: row.name, goalType: row.goalType, targetAmountMinor: row.targetAmountMinor,
    targetDate: row.targetDate?.toISOString() ?? null, currentAmountMinor: row.currentAmountMinor,
    progressBps: row.targetAmountMinor > 0 ? Math.min(10_000, Math.round((row.currentAmountMinor / row.targetAmountMinor) * 10_000)) : 0,
    monthlyTargetMinor: row.monthlyTargetMinor,
    requiredMonthlyMinor: Math.round(remaining / months),
    status: row.status, note: row.notes,
  };
}

export async function listGoals(userId: string) {
  const rows = await prisma.investmentGoal.findMany({ where: { userId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map(goalView);
}

export async function createGoal(userId: string, input: InvestmentGoalInput) {
  const row = await prisma.investmentGoal.create({
    data: {
      userId, name: input.name, goalType: input.goalType,
      targetAmountMinor: input.targetAmountMinor,
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
      monthlyTargetMinor: input.monthlyTargetMinor ?? null,
      notes: input.notes ?? null,
    },
  });
  await publishSecurityEvent({
    eventId: `inv_goal_${row.id}`, type: "INVESTMENT_GOAL_CREATED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "investments",
    metadata: { targetAmountMinor: input.targetAmountMinor },
  });
  return goalView(row);
}

export async function updateGoal(userId: string, id: string, input: Partial<InvestmentGoalInput>) {
  const row = await prisma.investmentGoal.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Goal not found.");
  const updated = await prisma.investmentGoal.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.targetAmountMinor ? { targetAmountMinor: input.targetAmountMinor } : {}),
      ...(input.targetDate ? { targetDate: new Date(input.targetDate) } : {}),
      ...(input.monthlyTargetMinor !== undefined ? { monthlyTargetMinor: input.monthlyTargetMinor } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
  return goalView(updated);
}

export async function addContribution(userId: string, goalId: string, input: GoalContributionInput) {
  const goal = await prisma.investmentGoal.findFirst({ where: { id: goalId, userId } });
  if (!goal) throw new ApiError(404, "AUTHORIZATION_ERROR", "Goal not found.");
  const [contribution, updated] = await prisma.$transaction([
    prisma.investmentGoalContribution.create({
      data: { goalId, userId, amountMinor: input.amountMinor, kind: input.kind, note: input.note ?? null },
    }),
    prisma.investmentGoal.update({
      where: { id: goalId },
      data: { currentAmountMinor: { increment: input.amountMinor } },
    }),
  ]);
  const pct = updated.targetAmountMinor > 0 ? Math.round((updated.currentAmountMinor / updated.targetAmountMinor) * 100) : 0;
  if (pct >= 100) {
    await prisma.investmentGoal.update({ where: { id: goalId }, data: { status: "ACHIEVED" } });
    await createNotification(prisma, {
      userId, type: "INVESTMENT_GOAL_MILESTONE", title: "Investment goal achieved",
      body: `You reached your goal: ${goal.name}.`, data: { goalId },
    });
  }
  return contribution;
}
