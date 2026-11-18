import { prisma } from "@nexus/database";
import type { PromoValidation } from "@nexus/shared-types";
import type { RewardPromoValidateInput } from "@nexus/validation";


import { commitReservation, reserveBudget } from "@/lib/rewards/campaign-service";
import { notifyOnce, recordActivity } from "@/lib/rewards/reward-core";

export async function validatePromoCode(userId: string, input: RewardPromoValidateInput): Promise<PromoValidation> {
  const campaign = await prisma.rewardCampaign.findUnique({ where: { promoCode: input.code.toUpperCase() } });
  if (!campaign) {
    return { valid: false, campaignId: null, discountMinor: 0, originalMinor: input.amountMinor, payableMinor: input.amountMinor, reason: "Invalid promo code", reservationId: null };
  }
  const reject = (reason: string): PromoValidation => ({
    valid: false, campaignId: campaign.id, discountMinor: 0, originalMinor: input.amountMinor,
    payableMinor: input.amountMinor, reason, reservationId: null,
  });
  if (!["ACTIVE", "APPROVED", "SCHEDULED"].includes(campaign.status)) return reject("Campaign is not active");
  const now = new Date();
  if (campaign.startAt > now || campaign.endAt < now) return reject("Promo code has expired or is not yet active");
  if (input.merchantId && campaign.merchantId && campaign.merchantId !== input.merchantId) {
    return reject("Promo code is not valid for this merchant");
  }
  if (input.amountMinor < campaign.minSpendMinor) return reject(`Minimum spend is ${(campaign.minSpendMinor / 100).toFixed(2)} INR`);
  if (!["FIXED_DISCOUNT", "PERCENTAGE_DISCOUNT", "LIMITED_TIME_OFFER"].includes(campaign.type)) {
    return reject("This campaign does not provide a checkout discount");
  }

  const used = await prisma.promoCodeRedemption.count({ where: { promoCodeId: campaign.id, userId } });
  if (used >= campaign.perUserLimit) return reject("You have already used this code");
  if (campaign.globalRedemptionLimit !== null) {
    const globalUsed = await prisma.promoCodeRedemption.count({ where: { promoCodeId: campaign.id } });
    if (globalUsed >= campaign.globalRedemptionLimit) return reject("This code has reached its usage limit");
  }

  let discountMinor = 0;
  if (campaign.type === "FIXED_DISCOUNT" || campaign.discountMinor > 0) {
    discountMinor = campaign.discountMinor;
  } else if (campaign.discountBps > 0) {
    discountMinor = Math.round((input.amountMinor * campaign.discountBps) / 10_000);
  }
  if (campaign.maxRewardMinor > 0) discountMinor = Math.min(discountMinor, campaign.maxRewardMinor);
  discountMinor = Math.max(0, Math.min(discountMinor, input.amountMinor));
  if (discountMinor === 0) return reject("No discount is available for this purchase");

  const reservation = await reserveBudget({
    campaignId: campaign.id,
    userId,
    referenceType: "PROMO",
    referenceId: `${userId}:${input.orderId}`,
    amountMinor: discountMinor,
    ttlMs: 30 * 60_000,
  });
  if (!reservation) return reject("Campaign budget is exhausted");

  return {
    valid: true,
    campaignId: campaign.id,
    discountMinor,
    originalMinor: input.amountMinor,
    payableMinor: input.amountMinor - discountMinor,
    reason: null,
    reservationId: reservation.id,
  };
}

export async function consumePromoCode(input: {
  campaignId: string;
  userId: string;
  orderId: string;
  reservationId: string;
  discountMinor: number;
  paymentRef: string;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const prior = await tx.promoCodeRedemption.findFirst({
      where: { promoCodeId: input.campaignId, userId: input.userId, paymentRef: input.paymentRef },
    });
    if (prior) return;
    await tx.promoCodeRedemption.create({
      data: {
        promoCodeId: input.campaignId,
        userId: input.userId,
        paymentRef: input.paymentRef,
        discountMinor: input.discountMinor,
      },
    });
    await commitReservation(tx, input.reservationId);
  });
  await recordActivity(prisma, {
    userId: input.userId,
    type: "PROMO_DISCOUNT",
    description: `Promo discount of ${(input.discountMinor / 100).toFixed(2)} INR applied`,
    amountMinor: input.discountMinor,
    campaignId: input.campaignId,
    referenceId: input.paymentRef,
    status: "COMPLETED",
  });
  await notifyOnce(prisma, {
    userId: input.userId,
    type: "REWARD_PROMO_APPLIED",
    eventKey: `promo:${input.paymentRef}`,
    title: "Promo applied",
    body: `${(input.discountMinor / 100).toFixed(2)} INR discount was applied to your payment.`,
    data: { paymentRef: input.paymentRef, campaignId: input.campaignId },
  });
}

