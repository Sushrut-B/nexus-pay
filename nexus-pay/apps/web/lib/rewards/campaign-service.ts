import { prisma, type RewardCampaign } from "@nexus/database";
import type { CampaignView, RewardCampaignStatus } from "@nexus/shared-types";
import type { RewardCampaignCreateInput, RewardCampaignUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";
import { recordAdminAudit } from "@/lib/control/audit";
import { notifyOnce, type RewardDb } from "@/lib/rewards/reward-core";

const TRANSITIONS: Record<RewardCampaignStatus, RewardCampaignStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "ACTIVE", "PAUSED", "CANCELLED"],
  SCHEDULED: ["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"],
  ACTIVE: ["PAUSED", "EXHAUSTED", "EXPIRED", "CANCELLED"],
  PAUSED: ["ACTIVE", "CANCELLED", "EXPIRED"],
  EXHAUSTED: ["EXPIRED", "CANCELLED"],
  EXPIRED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function toCampaignView(campaign: RewardCampaign): CampaignView {
  return {
    id: campaign.id,
    merchantId: campaign.merchantId,
    ownerType: campaign.ownerType,
    name: campaign.name,
    description: campaign.description,
    type: campaign.type,
    status: campaign.status,
    startAt: campaign.startAt.toISOString(),
    endAt: campaign.endAt.toISOString(),
    minSpendMinor: campaign.minSpendMinor,
    maxRewardMinor: campaign.maxRewardMinor,
    budgetMinor: campaign.budgetMinor,
    consumedMinor: campaign.consumedMinor,
    reservedMinor: campaign.reservedMinor,
    perUserLimit: campaign.perUserLimit,
    promoCode: campaign.promoCode,
    eligibleCategories: campaign.eligibleCategories,
    terms: campaign.terms,
    rejectionReason: campaign.rejectionReason,
    createdAt: campaign.createdAt.toISOString(),
  };
}

export async function createCampaign(userId: string, input: RewardCampaignCreateInput): Promise<CampaignView> {
  const merchant = await requireMerchantForUser(userId);
  if (input.promoCode) {
    const taken = await prisma.rewardCampaign.findUnique({ where: { promoCode: input.promoCode } });
    if (taken) throw new ApiError(409, "VALIDATION_ERROR", "That promo code is already in use.");
  }
  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.rewardCampaign.create({
      data: {
        merchantId: merchant.id,
        ownerType: "MERCHANT",
        name: input.name,
        description: input.description,
        type: input.type,
        status: "DRAFT",
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        minSpendMinor: input.minSpendMinor,
        maxRewardMinor: input.maxRewardMinor,
        pointsPerMinor: input.pointsPerMinor,
        cashbackBps: input.cashbackBps,
        bonusPoints: input.bonusPoints,
        discountBps: input.discountBps,
        discountMinor: input.discountMinor,
        budgetMinor: input.budgetMinor,
        pointsBudget: input.pointsBudget,
        perUserLimit: input.perUserLimit,
        globalRedemptionLimit: input.globalRedemptionLimit ?? null,
        eligibleCategories: [...input.eligibleCategories],
        customerSegments: [...input.customerSegments],
        promoCode: input.promoCode ?? null,
        terms: input.terms ?? null,
        createdBy: userId,
      },
    });
    await tx.campaignBudget.create({
      data: {
        campaignId: created.id,
        allocatedMinor: input.budgetMinor,
        pointsAllocated: input.pointsBudget,
      },
    });
    return created;
  });
  return toCampaignView(campaign);
}

export async function listCampaignsForMerchant(userId: string): Promise<CampaignView[]> {
  const merchant = await requireMerchantForUser(userId);
  const campaigns = await prisma.rewardCampaign.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return campaigns.map(toCampaignView);
}

export async function getCampaignForMerchant(userId: string, id: string): Promise<CampaignView> {
  const merchant = await requireMerchantForUser(userId);
  const campaign = await prisma.rewardCampaign.findFirst({ where: { id, merchantId: merchant.id } });
  if (!campaign) throw new ApiError(404, "AUTHORIZATION_ERROR", "Campaign not found.");
  return toCampaignView(campaign);
}

export async function updateCampaign(userId: string, id: string, input: RewardCampaignUpdateInput): Promise<CampaignView> {
  const merchant = await requireMerchantForUser(userId);
  const campaign = await prisma.rewardCampaign.findFirst({ where: { id, merchantId: merchant.id } });
  if (!campaign) throw new ApiError(404, "AUTHORIZATION_ERROR", "Campaign not found.");
  if (!["DRAFT", "REJECTED"].includes(campaign.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "Only draft or rejected campaigns can be edited.");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.rewardCampaign.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        type: input.type,
        startAt: input.startAt ? new Date(input.startAt) : undefined,
        endAt: input.endAt ? new Date(input.endAt) : undefined,
        minSpendMinor: input.minSpendMinor,
        maxRewardMinor: input.maxRewardMinor,
        pointsPerMinor: input.pointsPerMinor,
        cashbackBps: input.cashbackBps,
        bonusPoints: input.bonusPoints,
        discountBps: input.discountBps,
        discountMinor: input.discountMinor,
        budgetMinor: input.budgetMinor,
        pointsBudget: input.pointsBudget,
        perUserLimit: input.perUserLimit,
        eligibleCategories: input.eligibleCategories ? [...input.eligibleCategories] : undefined,
        customerSegments: input.customerSegments ? [...input.customerSegments] : undefined,
        promoCode: input.promoCode,
        terms: input.terms,
        status: "DRAFT",
        rejectionReason: null,
      },
    });
    if (input.budgetMinor !== undefined) {
      await tx.campaignBudget.update({ where: { campaignId: id }, data: { allocatedMinor: input.budgetMinor } });
    }
    return row;
  });
  return toCampaignView(updated);
}

export async function submitCampaign(userId: string, id: string): Promise<CampaignView> {
  const merchant = await requireMerchantForUser(userId);
  const campaign = await prisma.rewardCampaign.findFirst({ where: { id, merchantId: merchant.id } });
  if (!campaign) throw new ApiError(404, "AUTHORIZATION_ERROR", "Campaign not found.");
  if (!TRANSITIONS[campaign.status].includes("PENDING_APPROVAL")) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot submit a ${campaign.status} campaign.`);
  }
  const updated = await prisma.rewardCampaign.update({ where: { id }, data: { status: "PENDING_APPROVAL" } });
  return toCampaignView(updated);
}

export async function pauseCampaign(userId: string, id: string): Promise<CampaignView> {
  const merchant = await requireMerchantForUser(userId);
  const campaign = await prisma.rewardCampaign.findFirst({ where: { id, merchantId: merchant.id } });
  if (!campaign) throw new ApiError(404, "AUTHORIZATION_ERROR", "Campaign not found.");
  if (!TRANSITIONS[campaign.status].includes("PAUSED")) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot pause a ${campaign.status} campaign.`);
  }
  const updated = await prisma.rewardCampaign.update({ where: { id }, data: { status: "PAUSED" } });
  return toCampaignView(updated);
}

export async function setCampaignStatus(
  id: string,
  target: RewardCampaignStatus,
  reason: string,
  admin?: { id: string; email: string; roleName: string; requestId?: string },
): Promise<CampaignView> {
  const campaign = await prisma.rewardCampaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "AUTHORIZATION_ERROR", "Campaign not found.");
  if (!TRANSITIONS[campaign.status].includes(target)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Invalid campaign transition ${campaign.status} -> ${target}.`);
  }
  const updated = await prisma.rewardCampaign.update({
    where: { id },
    data: {
      status: target,
      ...(target === "REJECTED" ? { rejectionReason: reason } : {}),
      ...(target === "APPROVED" ? { approvedBy: admin?.id ?? null, approvedAt: new Date() } : {}),
    },
  });
  if (admin) {
    await recordAdminAudit({
      actorId: admin.id,
      actorEmail: admin.email,
      actorRole: admin.roleName,
      action: "REWARD_CAMPAIGN_STATUS_CHANGED",
      targetType: "reward_campaign",
      targetId: id,
      reason,
      requestId: admin.requestId,
      outcome: "SUCCESS",
      metadata: { from: campaign.status, to: target },
    });
  }
  if (campaign.merchantId && target === "APPROVED") {
    const owner = await prisma.merchant.findUnique({ where: { id: campaign.merchantId } });
    if (owner) {
      await notifyOnce(prisma, {
        userId: owner.ownerUserId,
        type: "REWARD_CAMPAIGN_ACTIVATED",
        eventKey: `campaign-approved:${id}`,
        title: "Campaign approved",
        body: `${campaign.name} was approved and can be scheduled.`,
        data: { campaignId: id },
      });
    }
  }
  return toCampaignView(updated);
}

/** Atomically reserve budget for a reward/promo. Never overspends. */
export async function reserveBudget(input: {
  campaignId: string;
  userId: string;
  referenceType: string;
  referenceId: string;
  amountMinor?: number;
  points?: number;
  ttlMs?: number;
}): Promise<{ id: string; amountMinor: number; points: number } | null> {
  const amountMinor = input.amountMinor ?? 0;
  const points = input.points ?? 0;
  const existing = await prisma.campaignBudgetReservation.findUnique({
    where: {
      campaignId_referenceType_referenceId: {
        campaignId: input.campaignId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    },
  });
  if (existing && existing.status !== "EXPIRED") {
    return { id: existing.id, amountMinor: existing.amountMinor, points: existing.points };
  }

  const claimed = await prisma.$transaction(async (tx) => {
    const budget = await tx.campaignBudget.findUnique({ where: { campaignId: input.campaignId } });
    if (!budget) return null;
    // Atomic conditional update prevents concurrent overspend: the database
    // re-checks available capacity at statement time, not at read time.
    const claimedBudget = await tx.$executeRaw`
      UPDATE campaign_budgets
      SET "reservedMinor" = "reservedMinor" + ${amountMinor},
          "pointsReserved" = "pointsReserved" + ${points},
          "updatedAt" = NOW()
      WHERE "campaignId" = ${input.campaignId}
        AND "allocatedMinor" - "consumedMinor" - "reservedMinor" >= ${amountMinor}
        AND "pointsAllocated" - "pointsConsumed" - "pointsReserved" >= ${points}
    `;
    if (claimedBudget !== 1) return null;
    const reservation = await tx.campaignBudgetReservation.upsert({
      where: {
        campaignId_referenceType_referenceId: {
          campaignId: input.campaignId,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
        },
      },
      create: {
        campaignId: input.campaignId,
        userId: input.userId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        amountMinor,
        points,
        status: "HELD",
        expiresAt: new Date(Date.now() + (input.ttlMs ?? 30 * 60_000)),
      },
      update: {
        amountMinor,
        points,
        status: "HELD",
        expiresAt: new Date(Date.now() + (input.ttlMs ?? 30 * 60_000)),
      },
    });
    return reservation;
  });
  return claimed ? { id: claimed.id, amountMinor: claimed.amountMinor, points: claimed.points } : null;
}

export async function commitReservation(db: RewardDb, reservationId: string): Promise<void> {
  const reservation = await db.campaignBudgetReservation.findUnique({ where: { id: reservationId } });
  if (!reservation || reservation.status !== "HELD") return;
  await db.campaignBudgetReservation.update({ where: { id: reservationId }, data: { status: "COMMITTED" } });
  await db.campaignBudget.update({
    where: { campaignId: reservation.campaignId },
    data: {
      reservedMinor: { decrement: reservation.amountMinor },
      consumedMinor: { increment: reservation.amountMinor },
      pointsReserved: { decrement: reservation.points },
      pointsConsumed: { increment: reservation.points },
    },
  });
  await db.rewardCampaign.update({ where: { id: reservation.campaignId }, data: { consumedMinor: { increment: reservation.amountMinor } } });
}

export async function releaseReservation(db: RewardDb, reservationId: string): Promise<void> {
  const reservation = await db.campaignBudgetReservation.findUnique({ where: { id: reservationId } });
  if (!reservation || reservation.status !== "HELD") return;
  await db.campaignBudgetReservation.update({ where: { id: reservationId }, data: { status: "RELEASED" } });
  await db.campaignBudget.update({
    where: { campaignId: reservation.campaignId },
    data: {
      reservedMinor: { decrement: reservation.amountMinor },
      pointsReserved: { decrement: reservation.points },
    },
  });
}

export async function cleanupExpiredReservations(): Promise<number> {
  const expired = await prisma.campaignBudgetReservation.findMany({
    where: { status: "HELD", expiresAt: { lte: new Date() } },
    take: 100,
  });
  for (const reservation of expired) {
    await releaseReservation(prisma, reservation.id);
    await prisma.campaignBudgetReservation.update({ where: { id: reservation.id }, data: { status: "EXPIRED" } });
  }
  return expired.length;
}
