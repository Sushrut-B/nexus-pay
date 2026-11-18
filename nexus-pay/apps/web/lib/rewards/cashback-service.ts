import { prisma, type CashbackEntitlement } from "@nexus/database";


import { ApiError } from "@/lib/api/response";
import {
  executeFundingOperation,
  getOrCreateFundingOperation,
  reconcileFundingOperation,
} from "@/lib/payments/funding-service";
import { notifyOnce, recordActivity, stableUuid } from "@/lib/rewards/reward-core";
import { commitReservation } from "@/lib/rewards/campaign-service";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

export function cashbackAmountMinor(amountMinor: number, cashbackBps: number, capMinor: number): number {
  if (cashbackBps <= 0) return 0;
  const raw = Math.round((amountMinor * cashbackBps) / 10_000);
  return capMinor > 0 ? Math.min(raw, capMinor) : raw;
}

export async function createCashbackEntitlement(input: {
  userId: string;
  campaignId: string;
  transactionRef: string;
  amountMinor: number;
  currency?: string;
  merchantId?: string;
}): Promise<CashbackEntitlement> {
  const existing = await prisma.cashbackEntitlement.findUnique({
    where: {
      userId_campaignId_transactionRef: {
        userId: input.userId,
        campaignId: input.campaignId,
        transactionRef: input.transactionRef,
      },
    },
  });
  if (existing) return existing;
  const key = `r8cashback:${input.transactionRef}:${input.campaignId}`;
  try {
    const entitlement = await prisma.cashbackEntitlement.create({
      data: {
        userId: input.userId,
        campaignId: input.campaignId,
        transactionRef: input.transactionRef,
        merchantId: input.merchantId ?? null,
        amountMinor: input.amountMinor,
        currency: input.currency ?? "INR",
        status: "ELIGIBLE",
        idempotencyKey: key,
      },
    });
    await recordActivity(prisma, {
      userId: input.userId,
      type: "CASHBACK_PENDING",
      description: `Cashback of ${(input.amountMinor / 100).toFixed(2)} INR is pending`,
      amountMinor: input.amountMinor,
      currency: "INR",
      merchantId: input.merchantId,
      campaignId: input.campaignId,
      transactionRef: input.transactionRef,
      referenceId: key,
      status: "PENDING",
    });
    await notifyOnce(prisma, {
      userId: input.userId,
      type: "REWARD_CASHBACK_PENDING",
      eventKey: `cashback-pending:${entitlement.id}`,
      title: "Cashback pending",
      body: `${(input.amountMinor / 100).toFixed(2)} INR cashback is being processed.`,
      data: { entitlementId: entitlement.id, campaignId: input.campaignId },
    });
    return entitlement;
  } catch {
    return prisma.cashbackEntitlement.findUniqueOrThrow({
      where: {
        userId_campaignId_transactionRef: {
          userId: input.userId,
          campaignId: input.campaignId,
          transactionRef: input.transactionRef,
        },
      },
    });
  }
}

export interface CashbackResult {
  entitlementId: string;
  outcome: "credited" | "pending" | "failed" | "skipped" | "unresolved";
  detail?: string;
}

/**
 * Credit one cashback entitlement through the existing simulated funding path.
 * The clientRequestId is derived deterministically from the entitlement, so a
 * worker restart or timeout reuses the exact same funding operation and key.
 */
export async function processCashbackEntitlement(entitlementId: string): Promise<CashbackResult> {
  const entitlement = await prisma.cashbackEntitlement.findUnique({ where: { id: entitlementId } });
  if (!entitlement) return { entitlementId, outcome: "skipped", detail: "Not found" };
  if (["CREDITED", "CANCELLED", "REVERSED"].includes(entitlement.status)) {
    return { entitlementId, outcome: "skipped", detail: entitlement.status };
  }

  const now = new Date();
  const claim = await prisma.cashbackEntitlement.updateMany({
    where: {
      id: entitlementId,
      status: { in: ["ELIGIBLE", "PENDING_CREDIT", "FAILED", "REQUIRES_RECONCILIATION"] },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      ],
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    },
  });
  if (claim.count === 0) return { entitlementId, outcome: "skipped", detail: "Claimed or not due" };

  const attempt = entitlement.attemptCount + 1;
  try {
    const campaign = await prisma.rewardCampaign.findUnique({ where: { id: entitlement.campaignId } });
    if (!campaign || !["ACTIVE", "SCHEDULED"].includes(campaign.status)) {
      throw new ApiError(409, "PAYMENT_ERROR", "Campaign is not active.");
    }

    // Reconcile an uncertain outcome before any new credit attempt.
    if (entitlement.status === "REQUIRES_RECONCILIATION" && entitlement.paymentRef) {
      const reconciled = await reconcileFundingOperation(
        await prisma.fundingOperation.findUniqueOrThrow({ where: { id: entitlement.paymentRef } }),
        { force: true },
      );
      if (reconciled.status !== "COMPLETED") {
        await prisma.cashbackEntitlement.update({
          where: { id: entitlementId },
          data: { status: "REQUIRES_RECONCILIATION", leaseUntil: null, lastErrorCode: "RECONCILIATION_REQUIRED" },
        });
        return { entitlementId, outcome: "unresolved", detail: "Reconciliation did not confirm credit" };
      }
      return finalizeCredit(entitlementId, reconciled.id);
    }

    const funding = await getOrCreateFundingOperation(entitlement.userId, {
      clientRequestId: stableUuid(entitlement.idempotencyKey),
      amountMinor: entitlement.amountMinor,
    });
    await prisma.cashbackEntitlement.update({
      where: { id: entitlementId },
      data: { fundingOperationId: funding.id, status: "PENDING_CREDIT" },
    });
    const result = await executeFundingOperation(funding.id, entitlement.userId);
    if (result.status === "COMPLETED" && result.fundingRef) {
      return finalizeCredit(entitlementId, result.fundingRef);
    }
    if (result.status === "COMPLETED" && !result.fundingRef) {
      await prisma.cashbackEntitlement.update({
        where: { id: entitlementId },
        data: { status: "REQUIRES_RECONCILIATION", leaseUntil: null, lastErrorCode: "RECEIPT_UNAVAILABLE" },
      });
      return { entitlementId, outcome: "unresolved", detail: "Receipt not readable yet" };
    }
    throw new ApiError(409, "PAYMENT_ERROR", result.failureMessage ?? `Funding status ${result.status}`);
  } catch (error) {
    const code = error instanceof ApiError ? error.category : "UNEXPECTED_ERROR";
    const exhausted = attempt >= MAX_ATTEMPTS;
    await prisma.$transaction(async (tx) => {
      await tx.cashbackEntitlement.update({
        where: { id: entitlementId },
        data: {
          status: exhausted ? "FAILED" : "PENDING_CREDIT",
          leaseUntil: null,
          lastErrorCode: code.slice(0, 80),
          failureCategory: code,
          nextAttemptAt: exhausted ? null : new Date(Date.now() + 60_000 * attempt),
        },
      });
      await tx.cashbackProcessingAttempt.create({
        data: { entitlementId, attempt, status: exhausted ? "FAILED" : "RETRY_PENDING", error: code.slice(0, 500) },
      });
    });
    if (exhausted) {
      await notifyOnce(prisma, {
        userId: entitlement.userId,
        type: "REWARD_CASHBACK_FAILED",
        eventKey: `cashback-failed:${entitlement.id}`,
        title: "Cashback could not be credited",
        body: "This sandbox cashback could not be confirmed. No money was moved.",
        data: { entitlementId, campaignId: entitlement.campaignId },
      });
    }
    return { entitlementId, outcome: "failed", detail: code };
  }
}

async function finalizeCredit(entitlementId: string, paymentRef: string): Promise<CashbackResult> {
  const entitlement = await prisma.cashbackEntitlement.findUniqueOrThrow({ where: { id: entitlementId } });
  if (entitlement.status === "CREDITED") return { entitlementId, outcome: "skipped" };
  await prisma.$transaction(async (tx) => {
    await tx.cashbackEntitlement.update({
      where: { id: entitlementId },
      data: {
        status: "CREDITED",
        paymentRef,
        resolvedAt: new Date(),
        leaseUntil: null,
        lastErrorCode: null,
        nextAttemptAt: null,
      },
    });
    await tx.cashbackProcessingAttempt.create({
      data: { entitlementId, attempt: entitlement.attemptCount, status: "CREDITED", paymentRef },
    });
    if (entitlement.fundingOperationId) await commitReservation(tx, entitlement.fundingOperationId);
    await recordActivity(tx, {
      userId: entitlement.userId,
      type: "CASHBACK_CREDITED",
      description: `Cashback credited: ${(entitlement.amountMinor / 100).toFixed(2)} INR (sandbox)`,
      amountMinor: entitlement.amountMinor,
      currency: entitlement.currency,
      campaignId: entitlement.campaignId,
      transactionRef: entitlement.transactionRef,
      referenceId: entitlement.idempotencyKey,
      status: "CREDITED",
    });
  });
  await notifyOnce(prisma, {
    userId: entitlement.userId,
    type: "REWARD_CASHBACK_CREDITED",
    eventKey: `cashback-credited:${entitlement.id}`,
    title: "Cashback credited",
    body: `${(entitlement.amountMinor / 100).toFixed(2)} INR sandbox cashback was credited to your wallet.`,
    data: { entitlementId, paymentRef },
  });
  return { entitlementId, outcome: "credited", detail: paymentRef };
}

export async function runCashbackWorker(limit = 25) {
  const due = await prisma.cashbackEntitlement.findMany({
    where: {
      status: { in: ["ELIGIBLE", "PENDING_CREDIT", "FAILED", "REQUIRES_RECONCILIATION"] },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }] },
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const result = { processed: 0, credited: 0, failed: 0, unresolved: 0 };
  for (const entitlement of due) {
    try {
      const outcome = await processCashbackEntitlement(entitlement.id);
      result.processed += 1;
      if (outcome.outcome === "credited") result.credited += 1;
      else if (outcome.outcome === "failed") result.failed += 1;
      else if (outcome.outcome === "unresolved") result.unresolved += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

