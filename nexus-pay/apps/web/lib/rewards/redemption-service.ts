import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@nexus/database";
import type { RewardCatalogueView } from "@nexus/shared-types";
import type { RewardRedeemInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getOrCreateRewardAccount, notifyOnce, recordActivity } from "@/lib/rewards/reward-core";

function toView(item: {
  id: string; name: string; description: string; merchantId: string | null; pointsCost: number;
  quantityTotal: number | null; quantityRedeemed: number; expiresAt: Date | null; terms: string | null; isActive: boolean;
}, merchantName: string | null, redeemedByUser: number): RewardCatalogueView {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    merchantName,
    pointsCost: item.pointsCost,
    remaining: item.quantityTotal === null ? null : Math.max(0, item.quantityTotal - item.quantityRedeemed),
    expiresAt: item.expiresAt?.toISOString() ?? null,
    terms: item.terms,
    active: item.isActive,
    redeemedByUser,
  };
}

export async function listCatalogue(userId: string): Promise<RewardCatalogueView[]> {
  const items = await prisma.rewardCatalogueItem.findMany({
    where: { isActive: true },
    orderBy: { pointsCost: "asc" },
    take: 100,
  });
  const merchantIds = [...new Set(items.map((item) => item.merchantId).filter((id): id is string => Boolean(id)))];
  const merchants = merchantIds.length
    ? await prisma.merchant.findMany({ where: { id: { in: merchantIds } } })
    : [];
  const names = new Map(merchants.map((merchant) => [merchant.id, merchant.displayName]));
  const redemptions = await prisma.rewardRedemption.groupBy({
    by: ["catalogueItemId"],
    where: { userId },
    _count: { _all: true },
  });
  const counts = new Map(redemptions.map((row) => [row.catalogueItemId, row._count._all]));
  return items.map((item) => toView(item, item.merchantId ? names.get(item.merchantId) ?? null : null, counts.get(item.id) ?? 0));
}

/**
 * Atomic points redemption. The unique (referenceType, referenceId, type) ledger
 * key plus the conditional balance decrement make concurrent redemption safe.
 */
export async function redeemReward(userId: string, input: RewardRedeemInput) {
  const account = await getOrCreateRewardAccount(userId);
  // Idempotency: the caller supplies a stable key; use it as the redemption reference.
  const prior = await prisma.rewardRedemption.findUnique({ where: { reference: input.idempotencyKey } });
  if (prior) return prior;

  const item = await prisma.rewardCatalogueItem.findUnique({ where: { id: input.catalogueItemId } });
  if (!item || !item.isActive) throw new ApiError(404, "PAYMENT_ERROR", "This reward is not available.");
  if (item.expiresAt && item.expiresAt <= new Date()) throw new ApiError(409, "PAYMENT_ERROR", "This reward has expired.");
  if (item.quantityTotal !== null && item.quantityRedeemed >= item.quantityTotal) {
    throw new ApiError(409, "PAYMENT_ERROR", "This reward is fully redeemed.");
  }
  if (account.availablePoints < item.pointsCost) {
    throw new ApiError(409, "PAYMENT_ERROR", "You do not have enough reward points.");
  }

  const reference = input.idempotencyKey;
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const redemption = await prisma.$transaction(async (tx) => {
    const claimed = await tx.rewardCatalogueItem.updateMany({
      where: { id: item.id, isActive: true, ...(item.quantityTotal !== null ? { quantityRedeemed: { lt: item.quantityTotal } } : {}) },
      data: { quantityRedeemed: { increment: 1 } },
    });
    if (claimed.count === 0) throw new ApiError(409, "PAYMENT_ERROR", "This reward is no longer available.");
    const debited = await tx.rewardAccount.updateMany({
      where: { id: account.id, availablePoints: { gte: item.pointsCost } },
      data: {
        availablePoints: { decrement: item.pointsCost },
        lifetimeRedeemedPoints: { increment: item.pointsCost },
      },
    });
    if (debited.count === 0) throw new ApiError(409, "PAYMENT_ERROR", "You do not have enough reward points.");
    const balance = await tx.rewardAccount.findUniqueOrThrow({ where: { id: account.id } });
    await tx.rewardLedgerEntry.create({
      data: {
        userId,
        accountId: account.id,
        type: "REDEEM",
        points: -item.pointsCost,
        balanceAfter: balance.availablePoints,
        referenceType: "REDEMPTION",
        referenceId: reference,
        description: `Redeemed ${item.name}`,
        idempotencyKey: `r8redeem:${reference}`,
        merchantId: item.merchantId ?? null,
      },
    });
    const created = await tx.rewardRedemption.create({
      data: {
        userId,
        catalogueItemId: item.id,
        pointsCost: item.pointsCost,
        reference,
        status: "COMPLETED",
        redeemedAt: new Date(),
        expiresAt: item.expiresAt ?? new Date(Date.now() + 30 * 86_400_000),
      },
    });
    await tx.rewardVoucher.create({
      data: {
        redemptionId: created.id,
        tokenHash,
        codeHint: token.slice(0, 4).toUpperCase(),
        status: "ACTIVE",
        expiresAt: item.expiresAt ?? new Date(Date.now() + 30 * 86_400_000),
      },
    });
    return created;
  });

  await recordActivity(prisma, {
    userId,
    type: "POINTS_REDEEMED",
    description: `Redeemed ${item.name}`,
    points: -item.pointsCost,
    referenceId: reference,
    status: "COMPLETED",
  });
  await notifyOnce(prisma, {
    userId,
    type: "REWARD_REDEMPTION_CONFIRMED",
    eventKey: `redemption:${redemption.id}`,
    title: "Reward redeemed",
    body: `${item.name} was redeemed for ${item.pointsCost} points.`,
    data: { redemptionId: redemption.id, reference },
  });
  return { ...redemption, voucherCodeHint: token.slice(0, 4).toUpperCase(), voucherToken: token };
}

export async function listRedemptions(userId: string) {
  const rows = await prisma.rewardRedemption.findMany({
    where: { userId },
    include: { voucher: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    pointsCost: row.pointsCost,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    voucherStatus: row.voucher?.status ?? null,
    voucherCodeHint: row.voucher?.codeHint ?? null,
  }));
}
