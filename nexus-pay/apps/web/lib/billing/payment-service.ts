import { randomUUID } from "node:crypto";
import { prisma, type BillPaymentIntent, type BillPaymentStatus } from "@nexus/database";
import type { BillPaymentView } from "@nexus/shared-types";
import type { BillPaymentCreateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getBillerAdapter } from "@/lib/billing/providers";
import { ensureCollectionUser } from "@/lib/billing/collection-account";
import { getInternalBiller } from "@/lib/billing/catalog-service";
import { getPayableSnapshot } from "@/lib/billing/bill-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { getOrCreatePaymentIntent, executePaymentIntent } from "@/lib/payments/payment-service";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

const TRANSITIONS: Record<BillPaymentStatus, BillPaymentStatus[]> = {
  CREATED: ["CUSTOMER_CONFIRMATION_REQUIRED", "PAYMENT_AUTHORIZED", "FAILED"],
  CUSTOMER_CONFIRMATION_REQUIRED: ["PAYMENT_AUTHORIZED", "FAILED"],
  PAYMENT_AUTHORIZED: ["WALLET_SETTLEMENT_PENDING", "FAILED"],
  WALLET_SETTLEMENT_PENDING: ["WALLET_SETTLED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  WALLET_SETTLED: ["PROVIDER_SUBMISSION_PENDING", "RECONCILIATION_REQUIRED", "REFUND_PENDING"],
  PROVIDER_SUBMISSION_PENDING: ["PROVIDER_PROCESSING", "BILLER_CONFIRMED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  PROVIDER_PROCESSING: ["BILLER_CONFIRMED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  BILLER_CONFIRMED: ["REFUND_PENDING"],
  FAILED: [], UNKNOWN: ["RECONCILIATION_REQUIRED", "BILLER_CONFIRMED", "FAILED"],
  RECONCILIATION_REQUIRED: ["BILLER_CONFIRMED", "FAILED", "REFUND_PENDING", "PARTIALLY_REVERSED"],
  REFUND_PENDING: ["REFUNDED", "PARTIALLY_REVERSED", "RECONCILIATION_REQUIRED"],
  REFUNDED: [], PARTIALLY_REVERSED: [],
};

export function paymentView(row: BillPaymentIntent & { biller: { name: string; category: { code: string } }; account: { maskedIdentifier: string } | null }): BillPaymentView {
  const stage: Record<BillPaymentStatus, string> = {
    CREATED: "Awaiting payment", CUSTOMER_CONFIRMATION_REQUIRED: "Awaiting payment",
    PAYMENT_AUTHORIZED: "Awaiting payment", WALLET_SETTLEMENT_PENDING: "Wallet debit processing",
    WALLET_SETTLED: "Wallet debit confirmed", PROVIDER_SUBMISSION_PENDING: "Biller processing",
    PROVIDER_PROCESSING: "Biller processing", BILLER_CONFIRMED: "Biller confirmed",
    FAILED: "Payment failed", UNKNOWN: "Payment outcome unknown",
    RECONCILIATION_REQUIRED: "Reconciliation required", REFUND_PENDING: "Refund pending",
    REFUNDED: "Refunded", PARTIALLY_REVERSED: "Partially reversed",
  };
  return {
    id: row.id, reference: row.reference, billerName: row.biller.name,
    category: row.biller.category.code as BillPaymentView["category"],
    maskedAccount: row.account?.maskedIdentifier ?? "ACCOUNT",
    amountMinor: row.amountMinor, feeMinor: row.feeMinor, totalMinor: row.totalMinor,
    status: row.status, paymentRef: row.paymentRef, providerRef: row.providerRef,
    confirmedAt: row.confirmedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    isSandbox: true, notice: stage[row.status],
  };
}

async function loadPayment(userId: string, id: string) {
  const row = await prisma.billPaymentIntent.findFirst({
    where: { OR: [{ id }, { reference: id }], userId },
    include: { biller: { include: { category: true } }, account: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Bill payment not found.");
  return row;
}

async function transition(paymentId: string, target: BillPaymentStatus, actor: string, evidence?: string) {
  const row = await prisma.billPaymentIntent.findUniqueOrThrow({ where: { id: paymentId } });
  if (row.status === target) return;
  if (!TRANSITIONS[row.status].includes(target)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot move bill payment from ${row.status} to ${target}.`);
  }
  await prisma.$transaction([
    prisma.billPaymentIntent.update({
      where: { id: paymentId },
      data: { status: target, ...(target === "BILLER_CONFIRMED" ? { confirmedAt: new Date() } : {}) },
    }),
    prisma.billPaymentStatusHistory.create({
      data: { paymentId, fromStatus: row.status, toStatus: target, actor, evidence },
    }),
  ]);
}

async function openReconciliationCase(input: { paymentId?: string; userId?: string; reason: string }) {
  const existing = await prisma.billReconciliationCase.findFirst({
    where: { paymentId: input.paymentId, status: { in: ["OPEN", "INVESTIGATING"] } },
  });
  if (existing) return existing;
  return prisma.billReconciliationCase.create({
    data: { reference: `recon_${randomUUID()}`, paymentId: input.paymentId ?? null, userId: input.userId ?? null, reason: input.reason },
  });
}

async function recordAttempt(paymentId: string, outcome: string, detail?: string) {
  const count = await prisma.billPaymentAttempt.count({ where: { paymentId } });
  await prisma.billPaymentAttempt.create({
    data: { paymentId, attemptNo: count + 1, outcome, detail },
  }).catch(() => undefined);
}

export async function createPayment(userId: string, input: BillPaymentCreateInput) {
  const existing = await prisma.billPaymentIntent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.userId === userId) return paymentView(await loadPayment(userId, existing.id) as never);
  if (existing) throw new ApiError(409, "PAYMENT_ERROR", "Idempotency key already used.");

  const snapshot = await getPayableSnapshot(userId, input.snapshotId);
  const fetchRequest = await prisma.billFetchRequest.findUniqueOrThrow({ where: { id: snapshot.fetchRequestId } });
  const biller = await getInternalBiller(fetchRequest.billerId);
  if (!biller.canPayBill) throw new ApiError(409, "PAYMENT_ERROR", "This biller does not support payments.");
  if (input.amountMinor < (snapshot.minAmountMinor ?? snapshot.amountMinor) || input.amountMinor > snapshot.amountMinor) {
    throw new ApiError(400, "VALIDATION_ERROR", "Amount must be within the bill's payable range.");
  }
  const providerRequestRef = `billreq_${randomUUID().replace(/-/g, "")}`;
  const row = await prisma.billPaymentIntent.create({
    data: {
      reference: `billpay_${randomUUID()}`, userId, billerId: biller.id,
      accountId: fetchRequest.accountId, snapshotId: snapshot.id,
      idempotencyKey: input.idempotencyKey, providerRequestRef,
      amountMinor: input.amountMinor, feeMinor: 0, totalMinor: input.amountMinor,
      status: "CUSTOMER_CONFIRMATION_REQUIRED",
      history: { create: { toStatus: "CREATED", actor: userId } },
    },
    include: { biller: { include: { category: true } }, account: true },
  });
  await prisma.billPaymentStatusHistory.create({ data: { paymentId: row.id, fromStatus: "CREATED", toStatus: "CUSTOMER_CONFIRMATION_REQUIRED", actor: userId } });
  await publishSecurityEvent({
    eventId: `bill_payment_init_${row.id}`, type: "BILL_PAYMENT_INITIATED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "billing", transactionRef: row.reference,
    metadata: { billerId: biller.id, amountMinor: input.amountMinor },
  });
  return paymentView(row as never);
}

export async function listPayments(userId: string, status?: string) {
  const rows = await prisma.billPaymentIntent.findMany({
    where: { userId, ...(status ? { status: status as BillPaymentStatus } : {}) },
    include: { biller: { include: { category: true } }, account: true },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => paymentView(row as never));
}

export async function getPayment(userId: string, id: string) {
  return paymentView(await loadPayment(userId, id) as never);
}

/**
 * Two-system orchestration. The wallet is settled through the EXISTING payment
 * engine; the biller provider is contacted only after a verified wallet
 * settlement. Never mutates balances directly and never creates a second ledger.
 */
export async function confirmPayment(userId: string, id: string) {
  const payment = await loadPayment(userId, id);
  if (!["CREATED", "CUSTOMER_CONFIRMATION_REQUIRED", "PAYMENT_AUTHORIZED", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(payment.status)) {
    return paymentView(payment as never); // idempotent replay of a settled/decided payment
  }
  const originalKey = payment.idempotencyKey;
  await transition(payment.id, "PAYMENT_AUTHORIZED", userId);
  await transition(payment.id, "WALLET_SETTLEMENT_PENDING", userId);

  // Biller is an internal collection account only in the labelled sandbox.
  const biller = await getInternalBiller(payment.billerId);
  const collection = await ensureCollectionUser(biller.code);
  const recipient = await searchRecipient(userId, collection.username);

  let engineResult;
  try {
    const intent = await getOrCreatePaymentIntent(userId, {
      clientRequestId: originalKey,
      recipientToken: recipient.recipientToken,
      amountMinor: payment.totalMinor,
      description: `Bill payment ${payment.reference}`,
    });
    await prisma.billPaymentIntent.update({ where: { id: payment.id }, data: { paymentIntentId: intent.id } });
    const recent = await prisma.billPaymentAttempt.count({ where: { paymentId: payment.id } });
    await recordAttempt(payment.id, "WALLET_SUBMISSION", `attempt ${recent + 1}, intent ${intent.id}`);
    engineResult = await executePaymentIntent(intent.id, userId);
  } catch (error) {
    await recordAttempt(payment.id, "WALLET_ERROR", error instanceof Error ? error.message.slice(0, 300) : "Engine error");
    throw error;
  }

  // Scenario B — wallet settlement confirmed failed: never submit to biller.
  if (engineResult.status === "REJECTED") {
    await transition(payment.id, "FAILED", "system", engineResult.rejectionCode ?? "Wallet settlement rejected");
    await publishSecurityEvent({ eventId: `bill_fail_${payment.id}`, type: "BILL_PAYMENT_FAILED", occurredAt: new Date(), actorId: userId, subjectId: payment.id, sourceModule: "billing", metadata: { stage: "WALLET" } });
    return paymentView(await loadPayment(userId, payment.id) as never);
  }
  // Scenario C/E — unknown wallet outcome: reconcile with Raftline, never submit to biller.
  if (engineResult.status === "UNKNOWN" || engineResult.status === "RECONCILIATION_REQUIRED") {
    await transition(payment.id, "UNKNOWN", "system", "Wallet settlement outcome unknown");
    await openReconciliationCase({ paymentId: payment.id, userId, reason: "WALLET_OUTCOME_UNKNOWN" });
    await publishSecurityEvent({ eventId: `bill_unknown_${payment.id}`, type: "BILL_PAYMENT_FAILED", occurredAt: new Date(), actorId: userId, subjectId: payment.id, sourceModule: "billing", metadata: { stage: "WALLET_UNKNOWN" } });
    return paymentView(await loadPayment(userId, payment.id) as never);
  }
  if (engineResult.status !== "SETTLED" || !engineResult.paymentRef) {
    await transition(payment.id, "RECONCILIATION_REQUIRED", "system", "Wallet settlement incomplete");
    await openReconciliationCase({ paymentId: payment.id, userId, reason: "WALLET_STATUS_INCOMPLETE" });
    return paymentView(await loadPayment(userId, payment.id) as never);
  }

  // Scenario A — wallet settled: record the settlement reference, then contact provider.
  await prisma.billPaymentIntent.update({ where: { id: payment.id }, data: { paymentRef: engineResult.paymentRef } });
  await transition(payment.id, "WALLET_SETTLED", "system", engineResult.paymentRef);
  await publishSecurityEvent({
    eventId: `bill_wallet_${payment.id}`, type: "BILL_PAYMENT_CONFIRMED", occurredAt: new Date(),
    actorId: userId, subjectId: payment.id, sourceModule: "billing", transactionRef: engineResult.paymentRef,
    metadata: { stage: "WALLET_SETTLED_ONLY", notice: "Wallet debit confirmed. Biller confirmation is separate." },
  });

  const provider = await prisma.billPaymentProvider.findUniqueOrThrow({ where: { id: biller.providerId } });
  const adapter = getBillerAdapter(provider.code);
  if (!adapter.capabilities.billPayment || !biller.canPayBill) {
    await transition(payment.id, "RECONCILIATION_REQUIRED", "system", "Provider payment unsupported after settlement");
    await openReconciliationCase({ paymentId: payment.id, userId, reason: "PROVIDER_PAYMENT_UNSUPPORTED" });
    return paymentView(await loadPayment(userId, payment.id) as never);
  }

  await transition(payment.id, "PROVIDER_SUBMISSION_PENDING", "system");
  let providerResult;
  try {
    providerResult = await adapter.initiatePayment({
      billerCode: biller.code,
      providerRequestRef: payment.providerRequestRef,
      amountMinor: payment.totalMinor,
      parameters: {},
    });
  } catch {
    providerResult = null;
  }
  await recordAttempt(payment.id, providerResult ? "PROVIDER_SUBMITTED" : "PROVIDER_ERROR", providerResult?.providerRef);
  if (!providerResult) {
    await transition(payment.id, "UNKNOWN", "system", "Provider response unknown");
    await openReconciliationCase({ paymentId: payment.id, userId, reason: "PROVIDER_RESPONSE_UNKNOWN" });
    return paymentView(await loadPayment(userId, payment.id) as never);
  }
  await prisma.billProviderTransaction.create({
    data: { paymentId: payment.id, providerRef: providerResult.providerRef, status: providerResult.status, payload: (providerResult.rawPayload ?? {}) as object },
  });
  await prisma.billPaymentIntent.update({ where: { id: payment.id }, data: { providerRef: providerResult.providerRef } });
  await transition(payment.id, "PROVIDER_PROCESSING", "system", providerResult.providerRef);

  const status = await adapter.getPaymentStatus(providerResult.providerRef);
  if (status && status.status === "BILLER_CONFIRMED") {
    await transition(payment.id, "BILLER_CONFIRMED", "provider", providerResult.providerRef);
    if (payment.snapshotId) {
      await prisma.billSnapshot.update({ where: { id: payment.snapshotId }, data: { status: "PAID" } }).catch(() => undefined);
    }
    await prisma.savedBillerAccount.updateMany({ where: { id: payment.accountId ?? "" }, data: { lastPaymentAt: new Date() } }).catch(() => undefined);
    await publishSecurityEvent({
      eventId: `bill_confirmed_${payment.id}`, type: "BILL_PAYMENT_CONFIRMED", occurredAt: new Date(),
      actorId: userId, subjectId: payment.id, sourceModule: "billing", transactionRef: providerResult.providerRef,
      metadata: { stage: "BILLER_CONFIRMED", walletPaymentRef: engineResult.paymentRef },
    });
    await securityAudit({
      actorType: "SYSTEM", actorId: "billing-orchestrator", action: "BILL_PAYMENT_CONFIRMED",
      targetType: "bill_payment_intent", targetId: payment.id,
      metadata: { walletPaymentRef: engineResult.paymentRef, providerRef: providerResult.providerRef },
    });
  } else {
    // Scenario D — provider rejected after wallet settlement: preserve settlement, do not mark bill paid.
    await transition(payment.id, "RECONCILIATION_REQUIRED", "system", "Provider payment failed after wallet settlement");
    await openReconciliationCase({ paymentId: payment.id, userId, reason: "PROVIDER_PAYMENT_FAILED_AFTER_SETTLEMENT" });
    await publishSecurityEvent({
      eventId: `bill_fail_${payment.id}`, type: "BILL_PAYMENT_FAILED", occurredAt: new Date(),
      actorId: userId, subjectId: payment.id, sourceModule: "billing", transactionRef: providerResult.providerRef,
      metadata: { stage: "PROVIDER", walletPaymentRef: engineResult.paymentRef },
    });
  }
  return paymentView(await loadPayment(userId, payment.id) as never);
}

export async function cancelPayment(userId: string, id: string) {
  const payment = await loadPayment(userId, id);
  if (!["CREATED", "CUSTOMER_CONFIRMATION_REQUIRED"].includes(payment.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This bill payment can no longer be cancelled.");
  }
  await transition(payment.id, "FAILED", userId, "Cancelled by customer");
  return paymentView(await loadPayment(userId, payment.id) as never);
}

export const BILL_PAYMENT_TRANSITIONS = TRANSITIONS;
