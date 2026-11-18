import { prisma, type RewardEntryType, type RewardLedgerEntry } from "@nexus/database";
import type { RewardActivityType } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getOrCreateRewardAccount, recordActivity, type RewardDb } from "@/lib/rewards/reward-core";

export interface LedgerInput {
  userId: string;
  type: RewardEntryType;
  points: number;
  referenceType: string;
  referenceId: string;
  description: string;
  idempotencyKey: string;
  merchantId?: string;
  campaignId?: string;
  transactionRef?: string;
  expiresAt?: Date;
  activityType?: RewardActivityType;
  amountMinor?: number;
  currency?: string;
  merchantName?: string;
}

export async function appendLedgerEntry(input: LedgerInput): Promise<RewardLedgerEntry> {
  if (!Number.isSafeInteger(input.points) || input.points === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Points must be a non-zero integer.");
  }
  const account = await getOrCreateRewardAccount(input.userId);
  const existing = await prisma.rewardLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const debit = input.points < 0;
    const magnitude = Math.abs(input.points);
    if ( debit) {
      const claimed = await tx.rewardAccount.updateMany({
        where: { id: account.id, availablePoints: { gte: magnitude } },
        data: { availablePoints: { decrement: magnitude } },
      });
      if (claimed.count === 0) {
        throw new ApiError(409, "PAYMENT_ERROR", "Insufficient reward points for this operation.");
      }
    } else {
      await tx.rewardAccount.update({
        where: { id: account.id },
        data: {
          availablePoints: { increment: magnitude },
          ...(input.type === "EARN" || input.type === "BONUS"
            ? { lifetimeEarnedPoints: { increment: magnitude } }
            : {}),
          ...(input.type === "REDEEM" ? { lifetimeRedeemedPoints: { increment: magnitude } } : {}),
        },
      });
    }
    const updated = await tx.rewardAccount.findUniqueOrThrow({ where: { id: account.id } });
    const entry = await tx.rewardLedgerEntry.create({
      data: {
        userId: input.userId,
        accountId: account.id,
        type: input.type,
        points: input.points,
        balanceAfter: updated.availablePoints,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description.slice(0, 300),
        idempotencyKey: input.idempotencyKey,
        merchantId: input.merchantId ?? null,
        campaignId: input.campaignId ?? null,
        transactionRef: input.transactionRef ?? null,
        expiresAt: input.expiresAt ?? null,
      },
    });
    if (input.activityType) {
      await recordActivity(tx, {
        userId: input.userId,
        type: input.activityType,
        description: input.description,
        points: input.points,
        amountMinor: input.amountMinor,
        currency: input.currency,
        merchantId: input.merchantId,
        merchantName: input.merchantName,
        campaignId: input.campaignId,
        transactionRef: input.transactionRef,
        referenceId: input.referenceId,
        expiresAt: input.expiresAt,
      });
    }
    return entry;
  });
}

/** Award points for a settled transaction. Replay-safe via unique idempotency key. */
export async function awardPointsForTransaction(input: {
  userId: string;
  paymentRef: string;
  points: number;
  campaignId?: string;
  merchantId?: string;
  amountMinor: number;
  expiresAt?: Date;
}): Promise<RewardLedgerEntry | null> {
  if (input.points <= 0) return null;
  const key = `r8earn:${input.paymentRef}:${input.campaignId ?? "base"}`;
  return appendLedgerEntry({
    userId: input.userId,
    type: input.campaignId ? "BONUS" : "EARN",
    points: input.points,
    referenceType: "TRANSACTION",
    referenceId: input.campaignId ? `${input.paymentRef}:${input.campaignId}` : input.paymentRef,
    description: input.campaignId ? `Campaign bonus for ${input.paymentRef}` : `Reward points for ${input.paymentRef}`,
    idempotencyKey: key,
    merchantId: input.merchantId,
    campaignId: input.campaignId,
    transactionRef: input.paymentRef,
    expiresAt: input.expiresAt,
    activityType: input.campaignId ? "CAMPAIGN_BONUS" : "POINTS_EARNED",
    amountMinor: input.amountMinor,
  });
}

/** Reverse points previously awarded. Safe interface; no wallet funds are touched. */
export async function reversePoints(input: {
  userId: string;
  paymentRef: string;
  points: number;
  reason: string;
  campaignId?: string;
}): Promise<RewardLedgerEntry | null> {
  const key = `r8reverse:${input.paymentRef}:${input.campaignId ?? "base"}`;
  const account = await getOrCreateRewardAccount(input.userId);
  if (account.availablePoints < input.points) {
    // Never create a negative balance. Record the reversal for review instead.
    await recordActivity(prisma, {
      userId: input.userId,
      type: "POINTS_REVERSED",
      description: `Reversal blocked: insufficient points (${input.reason})`,
      points: -input.points,
      referenceId: key,
      status: "BLOCKED_INSUFFICIENT_BALANCE",
    });
    return null;
  }
  return appendLedgerEntry({
    userId: input.userId,
    type: "REVERSE",
    points: -Math.abs(input.points),
    referenceType: "REVERSAL",
    referenceId: input.paymentRef,
    description: `Points reversed: ${input.reason}`,
    idempotencyKey: key,
    campaignId: input.campaignId,
    activityType: "POINTS_REVERSED",
    transactionRef: input.paymentRef,
  });
}

export async function ledgerBalance(db: RewardDb, userId: string): Promise<number> {
  const account = await db.rewardAccount.findUnique({ where: { userId } });
  return account?.availablePoints ?? 0;
}
