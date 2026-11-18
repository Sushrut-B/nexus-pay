import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { executePaymentIntent, getOrCreatePaymentIntent } from "@/lib/payments/payment-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { createNotification } from "@/lib/social/shared";
import { createWebhookEvent } from "@/lib/merchant/webhook-service";
import { addBillingInterval } from "@/lib/subscription/billing-calendar";
import { createInvoice } from "@/lib/subscription/invoice-service";
import {
  appendEvent,
  amountForOccurrence,
  ensureOccurrence,
} from "@/lib/subscription/subscription-core";

export type BillingOutcome = "settled" | "failed" | "unresolved" | "skipped" | "cancelled";

const LEASE_MS = 5 * 60_000;
const MAX_DUNNING_ATTEMPTS = 3;
const DUNNING_DELAYS_MS = [86_400_000, 3 * 86_400_000, 5 * 86_400_000];

const NON_RETRYABLE = new Set([
  "INSUFFICIENT_FUNDS",
  "SOURCE_ACCOUNT_NOT_FOUND",
  "DESTINATION_ACCOUNT_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "CURRENCY_MISMATCH",
  "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
  "INVALID_AMOUNT_MUST_BE_POSITIVE",
]);

export interface BillingResult {
  occurrenceId: string;
  outcome: BillingOutcome;
  detail?: string;
}

export function classifyFailure(code: string | null | undefined): string {
  if (!code) return "UNKNOWN";
  if (code === "INSUFFICIENT_FUNDS") return "INSUFFICIENT_BALANCE";
  if (code.includes("ACCOUNT")) return "WALLET_UNAVAILABLE";
  if (code.includes("CUSTOMER_ACTION") || code.includes("RECONCILIATION")) return "CUSTOMER_ACTION_REQUIRED";
  if (code.includes("TIMEOUT") || code.includes("UNAVAILABLE") || code.includes("RATE_LIMIT")) return "INFRASTRUCTURE";
  if (NON_RETRYABLE.has(code)) return "PERMANENT_REJECTION";
  return "PAYMENT_REJECTED";
}

function dunningDelay(attemptCount: number): number {
  return DUNNING_DELAYS_MS[Math.min(Math.max(attemptCount - 1, 0), DUNNING_DELAYS_MS.length - 1)];
}

/**
 * Process a single due billing occurrence. The occurrence idempotency key is
 * stable and is reused as the payment-intent clientRequestId, so a retry, a
 * worker restart or a second worker can never produce a second debit.
 */
export async function processBillingOccurrence(occurrenceId: string): Promise<BillingResult> {
  const occurrence = await prisma.billingOccurrence.findUnique({
    where: { id: occurrenceId },
    include: { subscription: { include: { plan: true, customer: { include: { profile: true } } } } },
  });
  if (!occurrence) return { occurrenceId, outcome: "skipped", detail: "Occurrence not found" };
  if (["SETTLED", "SKIPPED", "DEAD_LETTER"].includes(occurrence.status)) {
    return { occurrenceId, outcome: "skipped", detail: `Already ${occurrence.status}` };
  }
  if (["CANCELLED", "EXPIRED"].includes(occurrence.subscription.status)) {
    await prisma.billingOccurrence.update({
      where: { id: occurrenceId },
      data: { status: "SKIPPED", resolvedAt: new Date() },
    });
    return { occurrenceId, outcome: "cancelled" };
  }

  const now = new Date();
  const claim = await prisma.billingOccurrence.updateMany({
    where: {
      id: occurrenceId,
      status: { in: ["PENDING", "FAILED", "RECONCILIATION_REQUIRED"] },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    data: { status: "PROCESSING", attemptCount: { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claim.count === 0) return { occurrenceId, outcome: "skipped", detail: "Claimed by another worker or not due" };

  const attemptCount = occurrence.attemptCount + 1;
  const subscription = occurrence.subscription;
  const snapshot = subscription.pricingSnapshot as unknown as {
    currency: string;
    planName: string;
    setupFeeMinor: number;
    maxBillingPeriods: number | null;
  };

  try {
    // An unresolved occurrence keeps its original intent and idempotency key.
    // executePaymentIntent reconciles a non-CREATED intent against Raftline's
    // authoritative transaction lookup before considering any new attempt, so
    // no new key is ever generated and a lost response cannot double-debit.

    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: subscription.merchantId } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: merchant.ownerUserId } });
    const recipient = await searchRecipient(subscription.customerUserId, owner.username);
    const description = `${snapshot.planName} — ${amountForOccurrence(
      subscription.pricingSnapshot as never,
      occurrence.occurrenceNumber,
    ).description}`;

    // Stable per-attempt request id. An uncertain outcome always reuses the
    // exact previous request id; only a definitively rejected payment gets a
    // fresh attempt id on a later dunning retry. The occurrence idempotency key
    // itself never changes and remains the audit boundary for the period.
    let clientRequestId = occurrence.idempotencyKey;
    if (occurrence.paymentIntentId) {
      const prior = await prisma.paymentIntent.findUnique({ where: { id: occurrence.paymentIntentId } });
      if (prior) {
        if (occurrence.status === "RECONCILIATION_REQUIRED") {
          clientRequestId = prior.clientRequestId;
        } else if (prior.status === "REJECTED") {
          clientRequestId = `${occurrence.idempotencyKey}:attempt:${attemptCount}`;
        }
      }
    }

    const intent = await getOrCreatePaymentIntent(subscription.customerUserId, {
      clientRequestId,
      recipientToken: recipient.recipientToken,
      amountMinor: occurrence.amountMinor,
      description: description.slice(0, 280),
    });
    await prisma.billingOccurrence.update({
      where: { id: occurrenceId },
      data: { paymentIntentId: intent.id },
    });

    const payment = await executePaymentIntent(intent.id, subscription.customerUserId);

    if (payment.status === "SETTLED" && payment.paymentRef) {
      return finalizeSettlement(occurrenceId, payment.paymentRef);
    }

    if (payment.status === "REJECTED") {
      const code = payment.rejectionCode ?? "PAYMENT_REJECTED";
      return handleFailure(occurrenceId, attemptCount, code, payment.failureMessage ?? "Payment was rejected");
    }

    // UNKNOWN / RECONCILIATION_REQUIRED / PROCESSING — preserve the same intent and key.
    await prisma.$transaction(async (tx) => {
      await tx.billingOccurrence.update({
        where: { id: occurrenceId },
        data: {
          status: "RECONCILIATION_REQUIRED",
          leaseUntil: null,
          lastErrorCode: payment.status,
          failureCategory: "UNKNOWN_SETTLEMENT_OUTCOME",
        },
      });
      await appendEvent(tx, subscription.id, subscription.merchantId, "billing.outcome_unknown", "worker", {
        occurrenceId,
        paymentIntentId: intent.id,
      });
    });
    return { occurrenceId, outcome: "unresolved", detail: "Settlement outcome is not confirmed" };
  } catch (error) {
    const code = error instanceof ApiError ? error.category : "UNEXPECTED_ERROR";
    return handleFailure(occurrenceId, attemptCount, code, error instanceof Error ? error.message : "Billing failed");
  }
}

async function finalizeSettlement(occurrenceId: string, paymentRef: string): Promise<BillingResult> {
  const occurrence = await prisma.billingOccurrence.findUniqueOrThrow({
    where: { id: occurrenceId },
    include: { subscription: { include: { plan: true, customer: { include: { profile: true } } } } },
  });
  const subscription = occurrence.subscription;
  const snapshot = subscription.pricingSnapshot as unknown as {
    currency: string;
    planName: string;
    setupFeeMinor: number;
    maxBillingPeriods: number | null;
  };
  const setupFeeMinor = occurrence.occurrenceNumber === 1 ? snapshot.setupFeeMinor : 0;

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { occurrenceId: occurrenceId } });
    if (invoice) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paymentRef },
      });
    } else {
      const customerName = subscription.customer.profile?.displayName ?? subscription.customer.fullName;
      const created = await createInvoice(tx, {
        merchantId: subscription.merchantId,
        customerUserId: subscription.customerUserId,
        subscriptionId: subscription.id,
        occurrenceId,
        amountMinor: occurrence.amountMinor,
        setupFeeMinor,
        currency: snapshot.currency,
        description: `${snapshot.planName} — billing period ${occurrence.occurrenceNumber}`,
        periodStart: occurrence.periodStart,
        periodEnd: occurrence.periodEnd,
        dueDate: occurrence.periodEnd,
        customerName,
        customerEmail: subscription.customer.email,
      });
      await tx.invoice.update({ where: { id: created.id }, data: { status: "PAID", paymentRef } });
    }

    await tx.billingOccurrence.update({
      where: { id: occurrenceId },
      data: { status: "SETTLED", paymentRef, resolvedAt: new Date(), leaseUntil: null, lastErrorCode: null },
    });

    await tx.merchantPayment.create({
      data: {
        merchantId: subscription.merchantId,
        customerUserId: subscription.customerUserId,
        paymentIntentId: occurrence.paymentIntentId ?? occurrence.idempotencyKey,
        paymentRef,
        idempotencyKey: occurrence.idempotencyKey,
        amountMinor: occurrence.amountMinor + setupFeeMinor,
        currency: snapshot.currency,
        status: "SETTLED",
        source: "SUBSCRIPTION",
        settledAt: new Date(),
      },
    }).catch(() => undefined);

    const nextCount = subscription.occurrenceCount + 1;
    const endReached =
      snapshot.maxBillingPeriods !== null && nextCount >= snapshot.maxBillingPeriods;
    if (subscription.status === "CANCELLATION_SCHEDULED") {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED", occurrenceCount: nextCount, nextBillingDate: null, cancelledAt: new Date() },
      });
      await appendEvent(tx, subscription.id, subscription.merchantId, "subscription.cancelled", "worker", { occurrenceId });
    } else if (endReached) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "EXPIRED", occurrenceCount: nextCount, nextBillingDate: null },
      });
      await appendEvent(tx, subscription.id, subscription.merchantId, "subscription.expired", "worker", { occurrenceId });
    } else {
      const nextStart = occurrence.periodEnd;
      const nextEnd = addBillingInterval(nextStart, subscription.frequency, subscription.intervalCount);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: "ACTIVE",
          occurrenceCount: nextCount,
          currentPeriodStart: nextStart,
          currentPeriodEnd: nextEnd,
          nextBillingDate: nextEnd,
        },
      });
      await ensureOccurrence(tx, subscription, nextCount + 1, nextStart, nextEnd);
    }
    await appendEvent(tx, subscription.id, subscription.merchantId, "payment.succeeded", "worker", {
      occurrenceId,
      paymentRef,
      amountMinor: occurrence.amountMinor,
    });
    await createNotification(tx, {
      userId: subscription.customerUserId,
      type: "SUBSCRIPTION_RENEWAL_SUCCEEDED",
      title: "Subscription payment received",
      body: `${snapshot.planName} payment of ${(occurrence.amountMinor / 100).toFixed(2)} INR was confirmed.`,
      data: { subscriptionId: subscription.id, occurrenceId, paymentRef },
    });
    const merchant = await tx.merchant.findUniqueOrThrow({ where: { id: subscription.merchantId } });
    await createNotification(tx, {
      userId: merchant.ownerUserId,
      type: "SUBSCRIPTION_RENEWAL_SUCCEEDED",
      title: "Renewal collected",
      body: `${snapshot.planName} renewed successfully.`,
      data: { subscriptionId: subscription.id, occurrenceId },
    });
  });

  await createWebhookEvent(subscription.merchantId, "payment.succeeded", {
    paymentRef,
    amountMinor: occurrence.amountMinor,
    subscriptionId: subscription.id,
    occurrenceId,
  });
  return { occurrenceId, outcome: "settled", detail: paymentRef };
}

async function handleFailure(
  occurrenceId: string,
  attemptCount: number,
  code: string,
  message: string,
): Promise<BillingResult> {
  const occurrence = await prisma.billingOccurrence.findUniqueOrThrow({
    where: { id: occurrenceId },
    include: { subscription: { include: { plan: true, customer: { include: { profile: true } } } } },
  });
  const subscription = occurrence.subscription;
  const category = classifyFailure(code);
  const exhausted = attemptCount >= MAX_DUNNING_ATTEMPTS || category === "PERMANENT_REJECTION";
  const nextAttemptAt = exhausted ? null : new Date(Date.now() + dunningDelay(attemptCount));

  await prisma.$transaction(async (tx) => {
    await tx.billingOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status: exhausted ? "DEAD_LETTER" : "FAILED",
        leaseUntil: null,
        lastErrorCode: code.slice(0, 80),
        failureCategory: category,
        nextAttemptAt,
      },
    });
    const invoice = await tx.invoice.findFirst({ where: { occurrenceId } });
    if (invoice) await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAST_DUE" } });
    if (!["CANCELLED", "EXPIRED", "PAUSED"].includes(subscription.status)) {
      await tx.subscription.update({ where: { id: subscription.id }, data: { status: "PAST_DUE" } });
    }
    await appendEvent(tx, subscription.id, subscription.merchantId, "payment.failed", "worker", {
      occurrenceId,
      code,
      category,
    });
    await createNotification(tx, {
      userId: subscription.customerUserId,
      type: "SUBSCRIPTION_RENEWAL_FAILED",
      title: "Subscription payment needs attention",
      body: `${message} This did not move money; no new charge was created.`,
      data: { subscriptionId: subscription.id, occurrenceId, category },
    });
  });
  await createWebhookEvent(subscription.merchantId, "payment.failed", {
    subscriptionId: subscription.id,
    occurrenceId,
    code,
    category,
    executed: false,
  });
  return { occurrenceId, outcome: "failed", detail: code };
}

/** Trial expiry, scheduled cancellations and due renewals. */
export async function runBillingWorker(limit = 25): Promise<{ processed: number; settled: number; failed: number; skipped: number; unresolved: number }> {
  const result = { processed: 0, settled: 0, failed: 0, skipped: 0, unresolved: 0 };
  const now = new Date();

  // Trials whose trial period ended: activate and bill the first period.
  const maturedTrials = await prisma.subscription.findMany({
    where: { status: "TRIALING", trialEndDate: { lte: now } },
    take: limit,
  });
  for (const subscription of maturedTrials) {
    const periodEnd = addBillingInterval(subscription.currentPeriodStart, subscription.frequency, subscription.intervalCount);
    await prisma.$transaction(async (tx) => {
      await appendEvent(tx, subscription.id, subscription.merchantId, "subscription.activated", "worker", {});
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: subscription.status === "TRIALING" && subscription.cancellationReason ? "CANCELLATION_SCHEDULED" : "ACTIVE", currentPeriodEnd: periodEnd, nextBillingDate: subscription.currentPeriodStart },
      });
      await ensureOccurrence(tx, subscription, 1, subscription.currentPeriodStart, periodEnd, new Date(Date.now() - 1000));
    });
    await createNotification(prisma, {
      userId: subscription.customerUserId,
      type: "SUBSCRIPTION_TRIAL_ENDING",
      title: "Your trial has ended",
      body: "Your subscription is moving to its first paid billing period.",
      data: { subscriptionId: subscription.id },
    });
  }

  // End-of-period cancellations become final without charging again.
  const ending = await prisma.subscription.findMany({
    where: { status: "CANCELLATION_SCHEDULED", currentPeriodEnd: { lte: now } },
    take: limit,
  });
  for (const subscription of ending) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: "CANCELLED", nextBillingDate: null, cancelledAt: new Date() },
      });
      await appendEvent(tx, subscription.id, subscription.merchantId, "subscription.cancelled", "worker", { reason: "end_of_period" });
    });
    await createNotification(prisma, {
      userId: subscription.customerUserId,
      type: "SUBSCRIPTION_CANCELLED",
      title: "Subscription cancelled",
      body: "Your subscription has ended. No further payments will be collected.",
      data: { subscriptionId: subscription.id },
    });
  }

  // Due occurrences, including backed-off retries and unresolved cases.
  const due = await prisma.billingOccurrence.findMany({
    where: {
      status: { in: ["PENDING", "FAILED", "RECONCILIATION_REQUIRED"] },
      availableAt: { lte: now },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    orderBy: { availableAt: "asc" },
    take: limit,
  });
  for (const occurrence of due) {
    try {
      const outcome = await processBillingOccurrence(occurrence.id);
      result.processed += 1;
      if (outcome.outcome === "settled") result.settled += 1;
      else if (outcome.outcome === "failed") result.failed += 1;
      else if (outcome.outcome === "unresolved") result.unresolved += 1;
      else result.skipped += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
