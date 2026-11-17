import { prisma, type PaymentIntent } from "@nexus/database";
import type {
  AdminRole,
  PaymentOperationView,
  ReconciliationCaseView,
  ReconciliationStatus,
} from "@nexus/shared-types";
import type { ReconciliationResolveInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/control/audit";
import { getRaftlineReceipt } from "@/lib/control/raftline-adapter";
import { reconcilePaymentIntent } from "@/lib/payments/payment-service";

function mask(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value.length <= 4 ? "••••" : `•••• ${value.slice(-4)}`;
}

function settlementLabel(intent: PaymentIntent): PaymentOperationView["settlement"] {
  if (intent.status === "SETTLED") {
    return intent.lastWasIdempotentReplay ? "IDEMPOTENT_REPLAY" : "NEW_SUCCESS";
  }
  if (intent.status === "REJECTED") return "REJECTED";
  if (["UNKNOWN", "RECONCILIATION_REQUIRED"].includes(intent.status)) return "UNCERTAIN";
  return "UNCERTAIN";
}

function toView(intent: PaymentIntent & { transaction: { status: string } | null }): PaymentOperationView {
  return {
    intentId: intent.id,
    paymentRef: intent.paymentRef,
    idempotencyKeyMasked: mask(intent.idempotencyKey),
    senderWalletMasked: mask(intent.sourceAccountId),
    recipientWalletMasked: mask(intent.destinationAccountId),
    amountMinor: Number(intent.amountMinor),
    currency: intent.currency,
    rail: "INTERNAL_BOOK",
    status: intent.status,
    transactionStatus: intent.transaction?.status ?? null,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
    rejectionCode: intent.rejectionCode,
    failureMessage: intent.failureMessage,
    idempotentReplay: intent.lastWasIdempotentReplay,
    raftLogIndex: intent.raftLogIndex === null ? null : Number(intent.raftLogIndex),
    settlement: settlementLabel(intent),
  };
}

export async function listPaymentOperations(filters: {
  paymentRef?: string;
  intentId?: string;
  idempotencyKey?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<PaymentOperationView[]> {
  const where = {
    ...(filters.paymentRef ? { paymentRef: { contains: filters.paymentRef, mode: "insensitive" as const } } : {}),
    ...(filters.intentId ? { id: { contains: filters.intentId, mode: "insensitive" as const } } : {}),
    ...(filters.idempotencyKey ? { idempotencyKey: { contains: filters.idempotencyKey, mode: "insensitive" as const } } : {}),
    ...(filters.status ? { status: filters.status as PaymentIntent["status"] } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00.000Z`) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };
  const intents = await prisma.paymentIntent.findMany({
    where,
    include: { transaction: true },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
  });
  return intents.map(toView);
}

export async function getPaymentOperation(idOrRef: string): Promise<PaymentOperationView> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { OR: [{ id: idOrRef }, { paymentRef: idOrRef }, { idempotencyKey: idOrRef }] },
    include: { transaction: true },
  });
  if (!intent) throw new ApiError(404, "PAYMENT_ERROR", "That payment operation could not be found.");
  return toView(intent);
}

function caseToView(record: {
  id: string;
  paymentIntentId: string;
  paymentRef: string | null;
  idempotencyKey: string;
  applicationStatus: string;
  status: ReconciliationStatus;
  decision: string | null;
  reason: string | null;
  operatorId: string | null;
  evidence: unknown;
  createdAt: Date;
  resolvedAt: Date | null;
  attempts: Array<{ id: string; outcome: string; createdAt: Date; error: string | null }>;
}): ReconciliationCaseView {
  return {
    id: record.id,
    paymentIntentId: record.paymentIntentId,
    paymentRef: record.paymentRef,
    idempotencyKeyMasked: mask(record.idempotencyKey),
    applicationStatus: record.applicationStatus,
    status: record.status,
    decision: record.decision,
    reason: record.reason,
    operatorId: record.operatorId,
    evidence: (record.evidence ?? {}) as Record<string, unknown>,
    createdAt: record.createdAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    attempts: record.attempts.map((attempt) => ({
      id: attempt.id,
      outcome: attempt.outcome,
      createdAt: attempt.createdAt.toISOString(),
      error: attempt.error,
    })),
  };
}

export async function listReconciliationCases(): Promise<ReconciliationCaseView[]> {
  const cases = await prisma.reconciliationCase.findMany({
    include: { attempts: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return cases.map(caseToView);
}

export async function openReconciliationCase(
  intentIdOrRef: string,
  admin: { id: string; email: string; role: AdminRole; roleName: string },
  requestId: string,
): Promise<ReconciliationCaseView> {
  const intent = await prisma.paymentIntent.findFirst({
    where: { OR: [{ id: intentIdOrRef }, { paymentRef: intentIdOrRef }] },
  });
  if (!intent) throw new ApiError(404, "PAYMENT_ERROR", "That payment intent could not be found.");

  const existing = await prisma.reconciliationCase.findUnique({ where: { paymentIntentId: intent.id } });
  const record = existing ?? await prisma.reconciliationCase.create({
    data: {
      paymentIntentId: intent.id,
      paymentRef: intent.paymentRef,
      idempotencyKey: intent.idempotencyKey,
      applicationStatus: intent.status,
    },
  });

  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "RECONCILIATION_CASE_OPENED",
    targetType: "payment_intent",
    targetId: intent.id,
    requestId,
    outcome: "SUCCESS",
  });

  return caseToView({
    ...record,
    attempts: [],
  });
}

/**
 * Read authoritative evidence only. Never resubmit a payment and never create
 * a new idempotency key.
 */
export async function investigateReconciliation(
  caseId: string,
  admin: { id: string; email: string; role: AdminRole; roleName: string },
  requestId: string,
): Promise<ReconciliationCaseView> {
  const record = await prisma.reconciliationCase.findUnique({ where: { id: caseId } });
  if (!record) throw new ApiError(404, "PAYMENT_ERROR", "That reconciliation case could not be found.");

  const ref = record.paymentRef ?? record.idempotencyKey;
  const receipt = await getRaftlineReceipt(ref).catch(() => null);
  const evidence = {
    queriedRef: ref,
    queriedAt: new Date().toISOString(),
    receipt: receipt
      ? {
          paymentRef: receipt.paymentRef,
          status: receipt.status,
          amountCents: receipt.amountCents,
          currency: receipt.currency,
          sourceAccountId: mask(receipt.sourceAccountId),
          destinationAccountId: mask(receipt.destinationAccountId),
          idempotentReplay: receipt.isIdempotentReplay,
          raftLogIndex: receipt.raftLogIndex,
        }
      : null,
  };

  await prisma.reconciliationAttempt.create({
    data: {
      caseId,
      operatorId: admin.id,
      outcome: receipt ? "EVIDENCE_RETRIEVED" : "EVIDENCE_UNAVAILABLE",
      evidence: evidence as object,
      error: receipt ? null : "Raftline did not return a receipt for this reference.",
    },
  });
  await prisma.reconciliationCase.update({
    where: { id: caseId },
    data: {
      status: "UNDER_REVIEW",
      evidence: evidence as object,
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "RECONCILIATION_EVIDENCE_QUERIED",
    targetType: "reconciliation_case",
    targetId: caseId,
    requestId,
    outcome: receipt ? "SUCCESS" : "FAILURE",
    metadata: { queriedRef: ref },
  });

  const updated = await prisma.reconciliationCase.findUniqueOrThrow({
    where: { id: caseId },
    include: { attempts: { orderBy: { createdAt: "desc" } } },
  });
  return caseToView(updated);
}

export async function resolveReconciliation(
  caseId: string,
  input: ReconciliationResolveInput,
  admin: { id: string; email: string; role: AdminRole; roleName: string },
  requestId: string,
): Promise<ReconciliationCaseView> {
  const record = await prisma.reconciliationCase.findUnique({ where: { id: caseId } });
  if (!record) throw new ApiError(404, "PAYMENT_ERROR", "That reconciliation case could not be found.");
  if (["RESOLVED_SETTLED", "RESOLVED_REJECTED"].includes(record.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This case is already resolved.");
  }

  const receipt = (record.evidence as { receipt?: { status?: string; amountCents?: number } | null })?.receipt;
  if (input.decision === "RESOLVED_SETTLED") {
    if (!receipt || receipt.status?.toUpperCase() !== "SETTLED") {
      throw new ApiError(409, "PAYMENT_ERROR", "No settled Raftline receipt supports this decision.");
    }
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: record.paymentIntentId } });
    if (Number(intent.amountMinor) !== receipt.amountCents) {
      throw new ApiError(409, "PAYMENT_ERROR", "The receipt amount does not match the payment intent.");
    }
    // Reuse the existing state recovery path. It never resubmits a payment.
    await reconcilePaymentIntent(intent, { force: true }).catch(() => undefined);
  }
  if (input.decision === "RESOLVED_REJECTED" && !receipt) {
    throw new ApiError(409, "PAYMENT_ERROR", "No rejection evidence is available for this decision.");
  }

  await prisma.reconciliationCase.update({
    where: { id: caseId },
    data: {
      status: input.decision as ReconciliationStatus,
      decision: input.decision,
      reason: input.reason,
      operatorId: admin.id,
      resolvedAt: new Date(),
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "RECONCILIATION_RESOLVED",
    targetType: "reconciliation_case",
    targetId: caseId,
    reason: input.reason,
    requestId,
    outcome: "SUCCESS",
    metadata: { decision: input.decision },
  });

  const final = await prisma.reconciliationCase.findUniqueOrThrow({
    where: { id: caseId },
    include: { attempts: { orderBy: { createdAt: "desc" } } },
  });
  return caseToView(final);
}
