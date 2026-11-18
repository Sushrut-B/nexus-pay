import { randomBytes } from "node:crypto";
import { prisma, type SubscriptionPlan } from "@nexus/database";
import type { PlanView } from "@nexus/shared-types";
import type { SubscriptionPlanCreateInput, SubscriptionPlanUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

export function toPlanView(plan: SubscriptionPlan): PlanView {
  return {
    id: plan.id,
    merchantId: plan.merchantId,
    name: plan.name,
    description: plan.description,
    imageUrl: plan.imageUrl,
    amountMinor: plan.amountMinor,
    setupFeeMinor: plan.setupFeeMinor,
    currency: plan.currency,
    frequency: plan.frequency,
    intervalCount: plan.intervalCount,
    trialDays: plan.trialDays,
    introPriceMinor: plan.introPriceMinor,
    introPeriods: plan.introPeriods,
    maxBillingPeriods: plan.maxBillingPeriods,
    cancellationPolicy: plan.cancellationPolicy,
    visibility: plan.visibility,
    status: plan.status,
    checkoutToken: plan.checkoutToken,
    createdAt: plan.createdAt.toISOString(),
  };
}

export async function createPlan(userId: string, input: SubscriptionPlanCreateInput): Promise<PlanView> {
  const merchant = await requireMerchantForUser(userId);
  const plan = await prisma.subscriptionPlan.create({
    data: {
      merchantId: merchant.id,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      amountMinor: input.amountMinor,
      setupFeeMinor: input.setupFeeMinor,
      currency: input.currency,
      frequency: input.frequency,
      intervalCount: input.intervalCount,
      trialDays: input.trialDays,
      introPriceMinor: input.introPriceMinor ?? null,
      introPeriods: input.introPeriods,
      maxBillingPeriods: input.maxBillingPeriods ?? null,
      cancellationPolicy: input.cancellationPolicy ?? null,
      visibility: input.visibility,
      status: input.status,
      checkoutToken: randomBytes(24).toString("base64url"),
    },
  });
  return toPlanView(plan);
}

export async function listPlans(userId: string): Promise<PlanView[]> {
  const merchant = await requireMerchantForUser(userId);
  const plans = await prisma.subscriptionPlan.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
  });
  return plans.map(toPlanView);
}

export async function getPlanForUser(userId: string, planId: string): Promise<PlanView> {
  const merchant = await requireMerchantForUser(userId);
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, merchantId: merchant.id } });
  if (!plan) throw new ApiError(404, "AUTHORIZATION_ERROR", "Plan not found.");
  return toPlanView(plan);
}

/**
 * Editing a plan never rewrites existing subscriptions. The pricing snapshot
 * on each subscription is immutable; only future subscribers see new prices.
 */
export async function updatePlan(userId: string, planId: string, input: SubscriptionPlanUpdateInput): Promise<PlanView> {
  const merchant = await requireMerchantForUser(userId);
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, merchantId: merchant.id } });
  if (!plan) throw new ApiError(404, "AUTHORIZATION_ERROR", "Plan not found.");
  const updated = await prisma.subscriptionPlan.update({
    where: { id: planId },
    data: {
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl,
      amountMinor: input.amountMinor,
      setupFeeMinor: input.setupFeeMinor,
      frequency: input.frequency,
      intervalCount: input.intervalCount,
      trialDays: input.trialDays,
      introPriceMinor: input.introPriceMinor,
      introPeriods: input.introPeriods,
      maxBillingPeriods: input.maxBillingPeriods,
      cancellationPolicy: input.cancellationPolicy,
      visibility: input.visibility,
      status: input.status,
    },
  });
  return toPlanView(updated);
}

export async function setPlanStatus(
  userId: string,
  planId: string,
  status: "DRAFT" | "ACTIVE" | "ARCHIVED",
): Promise<PlanView> {
  const merchant = await requireMerchantForUser(userId);
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, merchantId: merchant.id } });
  if (!plan) throw new ApiError(404, "AUTHORIZATION_ERROR", "Plan not found.");
  const updated = await prisma.subscriptionPlan.update({ where: { id: planId }, data: { status } });
  return toPlanView(updated);
}

/** Public checkout resolution: never returns internal account ids. */
export async function resolvePublicPlan(token: string) {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: { checkoutToken: token },
    include: { merchant: true },
  });
  if (!plan) throw new ApiError(404, "PAYMENT_ERROR", "This subscription plan is unavailable.");
  if (plan.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "This plan is not accepting new subscribers.");
  if (plan.merchant.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "This merchant is not accepting payments.");
  return plan;
}
