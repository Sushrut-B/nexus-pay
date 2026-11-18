import { prisma, type BillingOccurrence, type Subscription, type SubscriptionPlan } from "@nexus/database";
import type { BillingOccurrenceView, SubscriptionEventView, SubscriptionView } from "@nexus/shared-types";
import type { SubscriptionCancelInput, SubscriptionPlanChangeInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";
import { addBillingInterval } from "@/lib/subscription/billing-calendar";
import {
  appendEvent,
  buildPricingSnapshot,
  ensureOccurrence,
  toSubscriptionView,
  transitionStatus,
} from "@/lib/subscription/subscription-core";

export function toOccurrenceView(occurrence: BillingOccurrence): BillingOccurrenceView {
  return {
    id: occurrence.id,
    subscriptionId: occurrence.subscriptionId,
    occurrenceNumber: occurrence.occurrenceNumber,
    periodStart: occurrence.periodStart.toISOString(),
    periodEnd: occurrence.periodEnd.toISOString(),
    amountMinor: occurrence.amountMinor,
    status: occurrence.status,
    attemptCount: occurrence.attemptCount,
    failureCategory: occurrence.failureCategory,
    paymentRef: occurrence.paymentRef,
    invoiceNumber: null,
    createdAt: occurrence.createdAt.toISOString(),
    resolvedAt: occurrence.resolvedAt?.toISOString() ?? null,
  };
}

/** Creates the subscription and its first billing occurrence when payment is due today. */
export async function createSubscriptionFromCheckout(
  customerUserId: string,
  plan: SubscriptionPlan,
  clientRequestId: string,
): Promise<{ subscription: SubscriptionView; occurrenceId: string | null; amountDueTodayMinor: number }> {
  const existing = await prisma.subscription.findFirst({
    where: {
      merchantId: plan.merchantId,
      customerUserId,
      planId: plan.id,
      status: { notIn: ["CANCELLED", "EXPIRED"] },
    },
  });
  if (existing) throw new ApiError(409, "PAYMENT_ERROR", "You already have an active subscription to this plan.");

  const now = new Date();
  const snapshot = buildPricingSnapshot(plan);
  const trialing = plan.trialDays > 0;
  const trialEnd = trialing ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;
  const periodStart = trialing ? trialEnd! : now;
  const periodEnd = addBillingInterval(periodStart, plan.frequency as never, plan.intervalCount);
  const setupFeeMinor = trialing ? 0 : plan.setupFeeMinor;
  const firstAmount = trialing
    ? 0
    : plan.introPriceMinor !== null && plan.introPeriods > 0
      ? plan.introPriceMinor
      : plan.amountMinor;

  const subscription = await prisma.subscription.create({
    data: {
      merchantId: plan.merchantId,
      customerUserId,
      planId: plan.id,
      pricingSnapshot: snapshot as object,
      frequency: plan.frequency,
      intervalCount: plan.intervalCount,
      status: trialing ? "TRIALING" : "PENDING",
      timezone: "Asia/Kolkata",
      startDate: now,
      trialEndDate: trialEnd,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodStart,
    },
  });
  await appendEvent(
    prisma,
    subscription.id,
    subscription.merchantId,
    trialing ? "subscription.trial_started" : "subscription.created",
    customerUserId,
    { clientRequestId, planId: plan.id },
  );

  let occurrenceId: string | null = null;
  if (!trialing) {
    const occurrence = await ensureOccurrence(prisma, subscription, 1, periodStart, periodEnd);
    occurrenceId = occurrence.id;
  }

  return {
    subscription: toSubscriptionView(subscription),
    occurrenceId,
    amountDueTodayMinor: firstAmount + setupFeeMinor,
  };
}

export async function listSubscriptionsForCustomer(userId: string): Promise<SubscriptionView[]> {
  const rows = await prisma.subscription.findMany({
    where: { customerUserId: userId },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toSubscriptionView);
}

export async function getSubscriptionForCustomer(userId: string, subscriptionId: string): Promise<SubscriptionView> {
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerUserId: userId },
    include: { plan: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  return toSubscriptionView(row);
}

export async function listSubscriptionsForMerchant(userId: string, status?: string): Promise<SubscriptionView[]> {
  const merchant = await requireMerchantForUser(userId);
  const rows = await prisma.subscription.findMany({
    where: { merchantId: merchant.id, ...(status ? { status: status as Subscription["status"] } : {}) },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toSubscriptionView);
}

export async function getSubscriptionForMerchant(userId: string, subscriptionId: string): Promise<SubscriptionView> {
  const merchant = await requireMerchantForUser(userId);
  const row = await prisma.subscription.findFirst({
    where: { id: subscriptionId, merchantId: merchant.id },
    include: { plan: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  return toSubscriptionView(row);
}

export async function listEvents(userId: string, subscriptionId: string): Promise<SubscriptionEventView[]> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      OR: [{ customerUserId: userId }, { merchant: { ownerUserId: userId } }],
    },
  });
  if (!subscription) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  const events = await prisma.subscriptionEvent.findMany({
    where: { subscriptionId },
    orderBy: { createdAt: "asc" },
  });
  return events.map((event) => ({
    id: event.id,
    event: event.event,
    actor: event.actor,
    metadata: event.metadata as Record<string, unknown> | null,
    createdAt: event.createdAt.toISOString(),
  }));
}

export async function listOccurrences(userId: string, subscriptionId: string): Promise<BillingOccurrenceView[]> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      OR: [{ customerUserId: userId }, { merchant: { ownerUserId: userId } }],
    },
  });
  if (!subscription) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  const rows = await prisma.billingOccurrence.findMany({
    where: { subscriptionId },
    orderBy: { occurrenceNumber: "desc" },
  });
  return rows.map(toOccurrenceView);
}

/** Merchant-authorized pause and resume. */
export async function pauseSubscription(userId: string, subscriptionId: string): Promise<SubscriptionView> {
  const merchant = await requireMerchantForUser(userId);
  const row = await prisma.subscription.findFirst({ where: { id: subscriptionId, merchantId: merchant.id } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  await prisma.$transaction(async (tx) => {
    await transitionStatus(tx, row, "PAUSED", userId);
    await tx.subscription.update({ where: { id: row.id }, data: { nextBillingDate: null } });
  });
  return getSubscriptionForMerchant(userId, subscriptionId);
}

export async function resumeSubscription(userId: string, subscriptionId: string): Promise<SubscriptionView> {
  const merchant = await requireMerchantForUser(userId);
  const row = await prisma.subscription.findFirst({ where: { id: subscriptionId, merchantId: merchant.id, status: "PAUSED" } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Paused subscription not found.");
  await prisma.$transaction(async (tx) => {
    await transitionStatus(tx, row, "ACTIVE", userId);
    await tx.subscription.update({
      where: { id: row.id },
      data: { nextBillingDate: new Date(), currentPeriodEnd: new Date() },
    });
  });
  return getSubscriptionForMerchant(userId, subscriptionId);
}

/**
 * Customer or merchant cancellation. IMMEDIATE transitions to CANCELLED;
 * END_OF_PERIOD keeps charging through the current period then stops at the
 * next billing run. Either way, a cancelled subscription is never charged again.
 */
export async function cancelSubscription(
  userId: string,
  subscriptionId: string,
  input: SubscriptionCancelInput,
  actor: "customer" | "merchant",
): Promise<SubscriptionView> {
  const row = await prisma.subscription.findFirst({
    where: {
      id: subscriptionId,
      ...(actor === "merchant"
        ? { merchant: { ownerUserId: userId } }
        : { customerUserId: userId }),
    },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  if (["CANCELLED", "EXPIRED"].includes(row.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This subscription is already closed.");
  }

  await prisma.$transaction(async (tx) => {
    const immediate = input.timing === "IMMEDIATE";
    if (immediate) {
      await transitionStatus(tx, row, "CANCELLED", userId, { reason: input.reason ?? "" });
      await tx.subscription.update({
        where: { id: row.id },
        data: { cancelledAt: new Date(), cancellationReason: input.reason ?? null, nextBillingDate: null },
      });
    } else {
      if (row.status !== "CANCELLATION_SCHEDULED") {
        await transitionStatus(tx, row, "CANCELLATION_SCHEDULED", userId, { reason: input.reason ?? "" });
      }
      await tx.subscription.update({
        where: { id: row.id },
        data: { cancelledAt: new Date(), cancellationReason: input.reason ?? null },
      });
    }
    const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: row.merchantId } });
    await tx.subscriptionEvent.create({
      data: {
        subscriptionId: row.id,
        merchantId: row.merchantId,
        event: "subscription.cancellation_requested",
        actor: `${actor}:${userId}`,
        metadata: { timing: input.timing, reason: input.reason ?? "", ownerUserId: merchant.ownerUserId } as object,
      },
    });
  });
  return prisma.subscription
    .findUniqueOrThrow({ where: { id: row.id }, include: { plan: true } })
    .then(toSubscriptionView);
}

/**
 * Plan changes take effect at the next billing period. The current period and
 * all historical invoices keep their original frozen pricing snapshot.
 */
export async function changePlan(
  userId: string,
  subscriptionId: string,
  input: SubscriptionPlanChangeInput,
): Promise<SubscriptionView> {
  const merchant = await requireMerchantForUser(userId);
  const row = await prisma.subscription.findFirst({ where: { id: subscriptionId, merchantId: merchant.id } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Subscription not found.");
  if (["CANCELLED", "EXPIRED"].includes(row.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "A closed subscription cannot change plans.");
  }
  const newPlan = await prisma.subscriptionPlan.findFirst({ where: { id: input.planId, merchantId: merchant.id } });
  if (!newPlan) throw new ApiError(404, "AUTHORIZATION_ERROR", "Target plan not found.");
  if (newPlan.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "Target plan is not active.");
  if (newPlan.id === row.planId) throw new ApiError(400, "VALIDATION_ERROR", "Already subscribed to this plan.");

  const snapshot = buildPricingSnapshot(newPlan);
  await prisma.$transaction(async (tx) => {
    await tx.planChange.create({
      data: {
        subscriptionId: row.id,
        merchantId: merchant.id,
        fromPlanId: row.planId,
        toPlanId: newPlan.id,
        reason: input.reason ?? null,
        effectiveDate: row.currentPeriodEnd,
        pricingSnapshot: snapshot as object,
        actor: userId,
      },
    });
    await tx.subscription.update({
      where: { id: row.id },
      data: { planId: newPlan.id, pricingSnapshot: snapshot as object, frequency: newPlan.frequency, intervalCount: newPlan.intervalCount },
    });
    await appendEvent(tx, row.id, row.merchantId, "subscription.plan_changed", userId, {
      fromPlanId: row.planId,
      toPlanId: newPlan.id,
      effective: row.currentPeriodEnd.toISOString(),
    });
  });
  return getSubscriptionForMerchant(userId, subscriptionId);
}
