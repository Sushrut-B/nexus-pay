import { randomBytes } from "node:crypto";
import { prisma } from "@nexus/database";
import type { ReferralView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { appendLedgerEntry } from "@/lib/rewards/ledger-service";
import { notifyOnce } from "@/lib/rewards/reward-core";

export async function getOrCreateReferralCode(userId: string) {
  const existing = await prisma.referralCode.findUnique({ where: { userId } });
  if (existing && !existing.revokedAt) return existing;
  const code = `NEXUS-${randomBytes(5).toString("hex").toUpperCase()}`;
  try {
    return await prisma.referralCode.create({ data: { userId, code } });
  } catch {
    return prisma.referralCode.findUniqueOrThrow({ where: { userId } });
  }
}

export async function attributeReferral(code: string, referredUserId: string) {
  const referral = await prisma.referralCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!referral || referral.revokedAt) throw new ApiError(404, "VALIDATION_ERROR", "Invalid referral code.");
  if (referral.userId === referredUserId) throw new ApiError(400, "VALIDATION_ERROR", "You cannot refer yourself.");
  const existing = await prisma.referralAttribution.findUnique({ where: { referredUserId } });
  if (existing) {
    if (existing.codeId === referral.id) return existing;
    throw new ApiError(409, "VALIDATION_ERROR", "You were already referred by another user.");
  }
  return prisma.referralAttribution.create({
    data: { codeId: referral.id, referredUserId, status: "PENDING" },
  });
}

/** Qualify referrals once the referred user completes one settled merchant payment. */
export async function runReferralQualification(limit = 50): Promise<number> {
  const pending = await prisma.referralAttribution.findMany({
    where: { status: "PENDING" },
    take: limit,
  });
  let qualified = 0;
  for (const attribution of pending) {
    const payment = await prisma.merchantPayment.findFirst({
      where: { customerUserId: attribution.referredUserId, status: "SETTLED" },
      orderBy: { createdAt: "asc" },
    });
    if (!payment || !payment.paymentRef) continue;
    const code = await prisma.referralCode.findUniqueOrThrow({ where: { id: attribution.codeId } });
    await prisma.$transaction(async (tx) => {
      await tx.referralAttribution.update({
        where: { id: attribution.id },
        data: { status: "QUALIFIED" },
      });
      await tx.referralQualification.upsert({
        where: { attributionId_qualificationType: { attributionId: attribution.id, qualificationType: "FIRST_MERCHANT_PAYMENT" } },
        create: {
          attributionId: attribution.id,
          qualificationType: "FIRST_MERCHANT_PAYMENT",
          transactionRef: payment.paymentRef,
          qualifiedAt: new Date(),
          status: "QUALIFIED",
        },
        update: {},
      });
      for (const [userId, type, points] of [
        [code.userId, "REFERRER", 100],
        [attribution.referredUserId, "REFERRED", 50],
      ] as const) {
        await tx.referralReward.upsert({
          where: { attributionId_userId_type: { attributionId: attribution.id, userId, type } },
          create: {
            attributionId: attribution.id,
            userId,
            type,
            points,
            status: "ISSUED",
            idempotencyKey: `r8referral:${attribution.id}:${type}`,
          },
          update: {},
        });
      }
    });
    await appendLedgerEntry({
      userId: code.userId,
      type: "BONUS",
      points: 100,
      referenceType: "REFERRAL",
      referenceId: `${attribution.id}:REFERRER`,
      description: "Referral reward",
      idempotencyKey: `r8referral:${attribution.id}:REFERRER`,
      activityType: "REFERRAL_REWARD",
    });
    await appendLedgerEntry({
      userId: attribution.referredUserId,
      type: "BONUS",
      points: 50,
      referenceType: "REFERRAL",
      referenceId: `${attribution.id}:REFERRED`,
      description: "Welcome referral reward",
      idempotencyKey: `r8referral:${attribution.id}:REFERRED`,
      activityType: "REFERRAL_REWARD",
    });
    await notifyOnce(prisma, {
      userId: code.userId,
      type: "REWARD_REFERRAL_QUALIFIED",
      eventKey: `referral-qualified:${attribution.id}`,
      title: "Referral qualified",
      body: "Your referred friend completed a qualifying payment.",
      data: { attributionId: attribution.id },
    });
    await notifyOnce(prisma, {
      userId: code.userId,
      type: "REWARD_REFERRAL_ISSUED",
      eventKey: `referral-issued:${attribution.id}:REFERRER`,
      title: "Referral reward issued",
      body: "100 points were added to your rewards account.",
      data: { attributionId: attribution.id },
    });
    qualified += 1;
  }
  return qualified;
}

export async function getReferralView(userId: string): Promise<ReferralView> {
  const code = await getOrCreateReferralCode(userId);
  const attributions = await prisma.referralAttribution.findMany({
    where: { codeId: code.id },
    include: { qualifications: true },
    orderBy: { referredAt: "desc" },
  });
  const rewards = await prisma.referralReward.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    code: code.code,
    link: `${origin}/register?ref=${encodeURIComponent(code.code)}`,
    referredCount: attributions.length,
    qualifiedCount: attributions.filter((a) => a.status === "QUALIFIED").length,
    pointsEarned: rewards.reduce((sum, r) => sum + r.points, 0),
    cashbackEarnedMinor: rewards.reduce((sum, r) => sum + r.cashbackMinor, 0),
    history: attributions.map((a) => ({
      type: a.status,
      status: a.qualifications.length ? a.qualifications[0]!.status : "PENDING",
      createdAt: a.referredAt.toISOString(),
    })),
  };
}

