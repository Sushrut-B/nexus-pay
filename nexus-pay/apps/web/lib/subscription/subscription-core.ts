import type { Prisma, Subscription, SubscriptionPlan } from "@nexus/database";
import { prisma } from "@nexus/database";
import type { PricingSnapshot, SubscriptionView, SubscriptionStatus, BillingFrequency } from "@nexus/shared-types";

export function buildPricingSnapshot(plan: SubscriptionPlan): PricingSnapshot {
  return {
    amountMinor: plan.amountMinor,
    setupFeeMinor: plan.setupFeeMinor,
    currency: plan.currency,
    frequency: plan.frequency as BillingFrequency,
    intervalCount: plan.intervalCount,
    trialDays: plan.trialDays,
    introPriceMinor: plan.introPriceMinor,
    introPeriods: plan.introPeriods,
    maxBillingPeriods: plan.maxBillingPeriods,
    planName: plan.name,
  };
}

export function toSubscriptionView(subscription: Subscription & { plan?: { name: string } | null }): SubscriptionView {
  const snapshot = subscription.pricingSnapshot as unknown as PricingSnapshot;
  return {
    id: subscription.id,
    merchantId: subscription.merchantId,
    customerUserId: subscription.customerUserId,
    planId: subscription.planId,
    planName: subscription.plan?.name ?? snapshot.planName ?? "Subscription plan",
    pricingSnapshot: snapshot,
    status: subscription.status,
    timezone: subscription.timezone,
    startDate: subscription.startDate.toISOString(),
    trialEndDate: subscription.trialEndDate?.toISOString() ?? null,
    currentPeriodStart: subscription.currentPeriodStart.toISOString(),
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    nextBillingDate: subscription.nextBillingDate?.toISOString() ?? null,
    cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
    cancellationReason: subscription.cancellationReason,
    occurrenceCount: subscription.occurrenceCount,
    createdAt: subscription.createdAt.toISOString(),
  };
}

/** Append-only lifecycle history. */
export async function appendEvent(
  db: Prisma.TransactionClient | typeof prisma,
  subscriptionId: string,
  merchantId: string,
  event: string,
  actor: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await db.subscriptionEvent.create({
    data: {
      subscriptionId,
      merchantId,
      event,
      actor,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

/** Amount charged for a given occurrence number, derived only from the frozen snapshot. */
export function amountForOccurrence(
  snapshot: PricingSnapshot,
  occurrenceNumber: number,
): { amountMinor: number; setupFeeMinor: number; description: string } {
  const setupFeeMinor = occurrenceNumber === 1 ? snapshot.setupFeeMinor : 0;
  const introActive = snapshot.introPriceMinor !== null && occurrenceNumber <= snapshot.introPeriods;
  const amountMinor = introActive ? snapshot.introPriceMinor! : snapshot.amountMinor;
  return {
    amountMinor,
    setupFeeMinor,
    description: introActive
      ? `${snapshot.planName} (introductory period ${occurrenceNumber})`
      : `${snapshot.planName} billing period ${occurrenceNumber}`,
  };
}

/** Stable per-period key. Never regenerated, even after a timeout or retry. */
export function occurrenceIdempotencyKey(subscriptionId: string, occurrenceNumber: number): string {
  return `r7sub:${subscriptionId}:${occurrenceNumber}`;
}

export async function ensureOccurrence(
  db: Prisma.TransactionClient | typeof prisma,
  subscription: Subscription,
  occurrenceNumber: number,
  periodStart: Date,
  periodEnd: Date,
  availableAt: Date = new Date(),
): Promise<{ id: string; created: boolean }> {
  const snapshot = subscription.pricingSnapshot as unknown as PricingSnapshot;
  const amount = amountForOccurrence(snapshot, occurrenceNumber);
  const idempotencyKey = occurrenceIdempotencyKey(subscription.id, occurrenceNumber);
  const existing = await db.billingOccurrence.findUnique({ where: { idempotencyKey } });
  if (existing) return { id: existing.id, created: false };
  try {
    const occurrence = await db.billingOccurrence.create({
      data: {
        subscriptionId: subscription.id,
        merchantId: subscription.merchantId,
        occurrenceNumber,
        periodStart,
        periodEnd,
        amountMinor: amount.amountMinor,
        currency: snapshot.currency,
        status: "PENDING",
        idempotencyKey,
        availableAt,
      },
    });
    return { id: occurrence.id, created: true };
  } catch {
    const raced = await db.billingOccurrence.findUnique({ where: { idempotencyKey } });
    if (raced) return { id: raced.id, created: false };
    throw new Error("Could not create billing occurrence");
  }
}

/** Explicit, server-enforced lifecycle transitions. */
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  PENDING: ["ACTIVE", "TRIALING", "INCOMPLETE", "CANCELLED"],
  TRIALING: ["ACTIVE", "CANCELLED", "PAST_DUE", "CANCELLATION_SCHEDULED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELLATION_SCHEDULED", "CANCELLED", "EXPIRED"],
  PAST_DUE: ["ACTIVE", "CANCELLED", "REQUIRES_CUSTOMER_ACTION", "EXPIRED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLATION_SCHEDULED: ["CANCELLED", "ACTIVE"],
  CANCELLED: [],
  EXPIRED: [],
  INCOMPLETE: ["ACTIVE", "CANCELLED", "REQUIRES_CUSTOMER_ACTION"],
  REQUIRES_CUSTOMER_ACTION: ["ACTIVE", "CANCELLED", "PAST_DUE"],
};

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionStatus(
  db: Prisma.TransactionClient | typeof prisma,
  subscription: Subscription,
  target: SubscriptionStatus,
  actor: string,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  if (!canTransition(subscription.status, target)) {
    throw new Error(`Invalid subscription transition ${subscription.status} -> ${target}`);
  }
  await db.subscription.update({ where: { id: subscription.id }, data: { status: target } });
  await appendEvent(db, subscription.id, subscription.merchantId, `status.${target.toLowerCase()}`, actor, metadata);
}
