import { prisma } from "@nexus/database";
import type { RewardInvestigationStatus, RiskSeverity } from "@nexus/database";
import type { RewardAdjustmentInput, RewardInvestigationCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { appendLedgerEntry } from "@/lib/rewards/ledger-service";
import { notifyOnce, recordActivity } from "@/lib/rewards/reward-core";
import { recordAdminAudit } from "@/lib/control/audit";

const LARGE_ADJUSTMENT_POINTS = 1_000;
const MAX_ADJUSTMENT_POINTS = 5_000;

export async function manualAdjustment(
  input: RewardAdjustmentInput,
  admin: { id: string; email: string; roleName: string; requestId?: string },
) {
  const magnitude = Math.abs(input.points);
  if (magnitude > MAX_ADJUSTMENT_POINTS) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Adjustments above 5,000 points require a separate approval workflow.");
  }
  if (magnitude > LARGE_ADJUSTMENT_POINTS && admin.roleName !== "SUPER_ADMIN") {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Large adjustments require a SUPER_ADMIN.");
  }
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw new ApiError(404, "AUTHORIZATION_ERROR", "User not found.");
  const existing = await prisma.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  const entry = await appendLedgerEntry({
    userId: input.userId,
    type: "ADJUST",
    points: input.points,
    referenceType: "MANUAL_ADJUSTMENT",
    referenceId: input.idempotencyKey,
    description: `Manual adjustment: ${input.reason}`,
    idempotencyKey: input.idempotencyKey,
    activityType: "MANUAL_ADJUSTMENT",
  });
  await recordActivity(prisma, {
    userId: input.userId,
    type: "MANUAL_ADJUSTMENT",
    description: `Manual adjustment: ${input.reason}`,
    points: input.points,
    referenceId: input.idempotencyKey,
    status: "COMPLETED",
  });
  await notifyOnce(prisma, {
    userId: input.userId,
    type: "REWARD_POINTS_EARNED",
    eventKey: `adjustment:${input.idempotencyKey}`,
    title: "Reward points adjusted",
    body: `${input.points > 0 ? "+" : ""}${input.points} points: ${input.reason}`,
    data: { entryId: entry.id },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "REWARD_MANUAL_ADJUSTMENT",
    targetType: "reward_account",
    targetId: input.userId,
    reason: input.reason,
    requestId: admin.requestId,
    outcome: "SUCCESS",
    metadata: { points: input.points, idempotencyKey: input.idempotencyKey },
  });
  return entry;
}

export interface RiskEventInput {
  userId?: string;
  relatedUserId?: string;
  campaignId?: string;
  transactionRef?: string;
  redemptionId?: string;
  severity?: RiskSeverity;
  reasonCode: string;
  description: string;
}

export async function createRiskEvent(input: RiskEventInput) {
  return prisma.rewardRiskEvent.create({
    data: {
      userId: input.userId ?? null,
      relatedUserId: input.relatedUserId ?? null,
      campaignId: input.campaignId ?? null,
      transactionRef: input.transactionRef ?? null,
      redemptionId: input.redemptionId ?? null,
      severity: input.severity ?? "MEDIUM",
      reasonCode: input.reasonCode,
      description: input.description.slice(0, 500),
      status: "OPEN",
    },
  });
}

export async function listInvestigations(status?: RewardInvestigationStatus) {
  return prisma.rewardInvestigation.findMany({
    where: { ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function createInvestigation(
  input: RewardInvestigationCreateInput,
  admin: { id: string; email: string; roleName: string; requestId?: string },
) {
  const created = await prisma.rewardInvestigation.create({
    data: {
      type: input.type,
      subjectId: input.subjectId,
      riskEventId: input.riskEventId ?? null,
      notes: input.notes ?? null,
      createdBy: admin.id,
      status: "OPEN",
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "REWARD_INVESTIGATION_CREATED",
    targetType: "reward_investigation",
    targetId: created.id,
    reason: input.notes ?? null,
    requestId: admin.requestId,
    outcome: "SUCCESS",
    metadata: { type: input.type, subjectId: input.subjectId },
  });
  return created;
}
