import { prisma } from "@nexus/database";
import type { RewardCampaign } from "@nexus/database";
import { awardPointsForTransaction } from "@/lib/rewards/ledger-service";
import { cashbackAmountMinor, createCashbackEntitlement } from "@/lib/rewards/cashback-service";
import { notifyOnce } from "@/lib/rewards/reward-core";

const LOOKBACK_MS = 14 * 86_400_000;

function campaignMatches(campaign: RewardCampaign, merchantId: string, amountMinor: number): boolean {
  if (!["ACTIVE", "SCHEDULED"].includes(campaign.status)) return false;
  const now = new Date();
  if (campaign.startAt > now || campaign.endAt < now) return false;
  if (campaign.merchantId && campaign.merchantId !== merchantId) return false;
  if (amountMinor < campaign.minSpendMinor) return false;
  return true;
}

/** Award base points and campaign rewards for one settled merchant payment. */
export async function processMerchantPaymentRewards(paymentId: string): Promise<{ points: number; cashback: number }> {
  const payment = await prisma.merchantPayment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.status !== "SETTLED" || !payment.paymentRef) return { points: 0, cashback: 0 };

  const basePoints = Math.floor(payment.amountMinor / 10_000); // 1 point per ₹100
  await awardPointsForTransaction({
    userId: payment.customerUserId,
    paymentRef: payment.paymentRef,
    points: basePoints,
    merchantId: payment.merchantId,
    amountMinor: payment.amountMinor,
  });
  if (basePoints > 0) {
    await notifyOnce(prisma, {
      userId: payment.customerUserId,
      type: "REWARD_POINTS_EARNED",
      eventKey: `earned:${payment.paymentRef}:base`,
      title: "Reward points earned",
      body: `${basePoints} points were added for your purchase.`,
      data: { paymentRef: payment.paymentRef },
    });
  }

  const campaigns = await prisma.rewardCampaign.findMany({
    where: {
      status: { in: ["ACTIVE", "SCHEDULED"] },
      OR: [{ merchantId: null }, { merchantId: payment.merchantId }],
    },
  });

  let bonusPoints = 0;
  let cashbackMinor = 0;
  for (const campaign of campaigns) {
    if (!campaignMatches(campaign, payment.merchantId, payment.amountMinor)) continue;
    const key = `r8cashback:${payment.paymentRef}:${campaign.id}`;
    if (campaign.type === "POINTS_MULTIPLIER" || campaign.type === "BONUS_POINTS") {
      const extra = Math.floor((payment.amountMinor * campaign.pointsPerMinor) / 10_000);
      if (extra > 0) {
        await awardPointsForTransaction({
          userId: payment.customerUserId,
          paymentRef: payment.paymentRef,
          points: extra,
          campaignId: campaign.id,
          merchantId: payment.merchantId,
          amountMinor: payment.amountMinor,
        });
        bonusPoints += extra;
      }
    }
    if (campaign.type === "CASHBACK") {
      const amount = cashbackAmountMinor(payment.amountMinor, campaign.cashbackBps, campaign.maxRewardMinor);
      if (amount >= 100) {
        const existing = await prisma.cashbackEntitlement.findUnique({
          where: {
            userId_campaignId_transactionRef: {
              userId: payment.customerUserId,
              campaignId: campaign.id,
              transactionRef: payment.paymentRef,
            },
          },
        });
        if (!existing) {
          await createCashbackEntitlement({
            userId: payment.customerUserId,
            campaignId: campaign.id,
            transactionRef: payment.paymentRef,
            amountMinor: amount,
            merchantId: payment.merchantId,
          });
          cashbackMinor += amount;
        }
      }
    }
    void key;
  }
  return { points: basePoints + bonusPoints, cashback: cashbackMinor };
}

/** Scan settled merchant payments that have not been evaluated for rewards. */
export async function runPointsEarningWorker(limit = 50): Promise<{ processed: number; points: number; cashbackMinor: number }> {
  const since = new Date(Date.now() - LOOKBACK_MS);
  const payments = await prisma.merchantPayment.findMany({
    where: { status: "SETTLED", createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const result = { processed: 0, points: 0, cashbackMinor: 0 };
  for (const payment of payments) {
    if (!payment.paymentRef) continue;
    const awarded = await prisma.rewardLedgerEntry.findFirst({
      where: { referenceType: "TRANSACTION", referenceId: payment.paymentRef },
    });
    const entitled = await prisma.cashbackEntitlement.findFirst({
      where: { transactionRef: payment.paymentRef },
    });
    if (awarded && entitled) continue;
    try {
      const outcome = await processMerchantPaymentRewards(payment.id);
      result.processed += 1;
      result.points += outcome.points;
      result.cashbackMinor += outcome.cashback;
    } catch {
      // A failed evaluation is retried on the next pass; no reward is fabricated.
    }
  }
  return result;
}
