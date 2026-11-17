import { randomUUID } from "node:crypto";
import {
  createRaftlineClient,
  RaftlineError,
  type RaftlinePaymentsClient,
  type RaftlineTransactionReceipt,
} from "@nexus/api-client";
import { Prisma, prisma, type PaymentIntent, type TransactionRecord } from "@nexus/database";
import type { PaymentView } from "@nexus/shared-types";
import type { SendPaymentInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { toPaymentView, toSafeMinor } from "@/lib/payments/dto";
import { withLedgerAccountLocks } from "@/lib/payments/ledger-lock";
import { resolveRecipientToken } from "@/lib/payments/recipient-service";
import {
  rejectionMessage,
  verifySettlementReceipt,
  type SettlementVerdict,
} from "@/lib/payments/verify";

const AMBIGUOUS_RETRY_GRACE_MS = 60_000;
const IN_FLIGHT_GRACE_MS = 35_000;
const MAX_AUTOMATIC_ATTEMPTS = 3;

const globalForRaftline = globalThis as unknown as {
  nexusPayRaftlineClient?: RaftlinePaymentsClient;
};

function getRaftlineClient(): RaftlinePaymentsClient {
  if (!globalForRaftline.nexusPayRaftlineClient) {
    globalForRaftline.nexusPayRaftlineClient = createRaftlineClient();
  }
  return globalForRaftline.nexusPayRaftlineClient;
}

type IntentWithTransaction = PaymentIntent & { transaction: TransactionRecord | null };

export async function getOrCreatePaymentIntent(
  userId: string,
  input: SendPaymentInput,
): Promise<PaymentView> {
  const existing = await prisma.paymentIntent.findUnique({
    where: {
      userId_clientRequestId: {
        userId,
        clientRequestId: input.clientRequestId,
      },
    },
    include: { transaction: true },
  });
  if (existing) {
    return toPaymentView(existing, existing.transaction);
  }

  const recipient = await resolveRecipientToken(input.recipientToken);
  if (recipient.user.id === userId) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot send money to yourself.");
  }

  const wallet = await prisma.wallet.findFirst({
    where: { userId, currency: "INR" },
  });
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "Your INR wallet must be active before you can send money.",
    );
  }

  await assertNoUnresolvedPayments(userId);

  const idempotencyKey = `np_pay_${randomUUID().replace(/-/g, "")}`;

  try {
    const intent = await prisma.$transaction(async (tx) => {
      // Serialise payment creation for this wallet without relying on process-local locks.
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`;

      const raced = await tx.paymentIntent.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
        include: { transaction: true },
      });
      if (raced) return raced;

      const unresolved = await tx.paymentIntent.count({
        where: {
          userId,
          status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
        },
      });
      if (unresolved > 0) {
        throw new ApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "A previous payment still needs ledger confirmation. Reconcile it before sending again.",
        );
      }

      return tx.paymentIntent.create({
        data: {
          userId,
          walletId: wallet.id,
          recipientUserId: recipient.user.id,
          clientRequestId: input.clientRequestId,
          idempotencyKey,
          recipientUsername: recipient.user.username,
          recipientDisplayName: recipient.profile.displayName,
          sourceAccountId: wallet.raftlineAccountId!,
          destinationAccountId: recipient.wallet.raftlineAccountId!,
          amountMinor: BigInt(input.amountMinor),
          currency: "INR",
          description: input.description ?? null,
          transaction: {
            create: {
              userId,
              walletId: wallet.id,
              kind: "P2P",
              direction: "SENT",
              status: "PROCESSING",
              amountMinor: BigInt(input.amountMinor),
              currency: "INR",
              counterpartyName: recipient.profile.displayName,
              counterpartyUsername: recipient.user.username,
              idempotencyKey,
              description: input.description ?? null,
              occurredAt: new Date(),
            },
          },
        },
        include: { transaction: true },
      });
    });

    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
      entityType: "payment_intent",
      entityId: intent.id,
      metadata: {
        amountMinor: input.amountMinor,
        currency: "INR",
        idempotencyKey,
      },
    });

    return toPaymentView(intent, intent.transaction);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.paymentIntent.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
        include: { transaction: true },
      });
      if (raced) return toPaymentView(raced, raced.transaction);
    }
    throw error;
  }
}

/**
 * Attempts the ledger settlement once and records only what the ledger receipt
 * proves. Ambiguous outcomes become UNKNOWN and are never shown as success.
 */
export async function executePaymentIntent(
  intentId: string,
  userId: string,
): Promise<PaymentView> {
  let intent = await loadIntent(intentId, userId);

  if (intent.status === "SETTLED" || intent.status === "REJECTED") {
    return toPaymentView(intent, intent.transaction);
  }

  if (intent.status !== "CREATED" || intent.attemptCount > 0) {
    await reconcilePaymentIntent(intent, { force: true });
    intent = await loadIntent(intentId, userId);
    if (intent.status === "SETTLED" || intent.status === "REJECTED") {
      return toPaymentView(intent, intent.transaction);
    }
    if (!mayAttempt(intent)) {
      return toPaymentView(intent, intent.transaction);
    }
  }

  const now = new Date();
  const claimed = await prisma.paymentIntent.updateMany({
    where: {
      id: intent.id,
      userId,
      status: { in: ["CREATED", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      attemptCount: { lt: MAX_AUTOMATIC_ATTEMPTS },
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      lastAttemptAt: now,
      failureMessage: null,
    },
  });

  if (claimed.count === 0) {
    const current = await loadIntent(intentId, userId);
    if (
      current.status === "PROCESSING" &&
      current.lastAttemptAt &&
      Date.now() - current.lastAttemptAt.getTime() > IN_FLIGHT_GRACE_MS
    ) {
      await reconcilePaymentIntent(current, { force: true });
      return getPaymentView(intentId, userId);
    }
    return toPaymentView(current, current.transaction);
  }

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PAYMENT_ATTEMPT_STARTED,
    entityType: "payment_intent",
    entityId: intent.id,
    metadata: { attempt: intent.attemptCount + 1, idempotencyKey: intent.idempotencyKey },
  });

  try {
    const receipt = await withLedgerAccountLocks(
      [intent.sourceAccountId, intent.destinationAccountId],
      () =>
        getRaftlineClient().settlePayment({
          idempotencyKey: intent.idempotencyKey,
          sourceAccountId: intent.sourceAccountId,
          destinationAccountId: intent.destinationAccountId,
          amountCents: toSafeMinor(intent.amountMinor) ?? 0,
          currency: intent.currency,
          description: intent.description ?? undefined,
        }),
    );
    return await applySettlementReceipt(intent, receipt);
  } catch (error) {
    return await handleSettlementFailure(intent, error);
  }
}

export async function reconcilePaymentIntent(
  intent: PaymentIntent,
  options: { force?: boolean } = {},
): Promise<PaymentIntent> {
  if (intent.status === "SETTLED" || intent.status === "REJECTED") return intent;

  const minIntervalMs = getServerEnv().PAYMENT_RECONCILIATION_MIN_INTERVAL_SECONDS * 1000;
  if (
    !options.force &&
    intent.lastReconciledAt &&
    Date.now() - intent.lastReconciledAt.getTime() < minIntervalMs
  ) {
    return intent;
  }

  await prisma.paymentIntent.updateMany({
    where: { id: intent.id, status: { notIn: ["SETTLED", "REJECTED"] } },
    data: { lastReconciledAt: new Date() },
  });

  let receipt: RaftlineTransactionReceipt | null;
  try {
    receipt = await getRaftlineClient().getTransaction(intent.idempotencyKey);
  } catch {
    // Reconciliation is best-effort. The durable status remains unresolved and
    // a later poll or send attempt will try again.
    return (await prisma.paymentIntent.findUnique({ where: { id: intent.id } })) ?? intent;
  }

  if (receipt) {
    const updated = await applySettlementReceipt(intent, receipt);
    return (await prisma.paymentIntent.findUnique({ where: { id: updated.id } })) ?? intent;
  }

  if (
    intent.status === "UNKNOWN" ||
    intent.status === "RECONCILIATION_REQUIRED" ||
    (intent.status === "PROCESSING" &&
      intent.lastAttemptAt &&
      Date.now() - intent.lastAttemptAt.getTime() > AMBIGUOUS_RETRY_GRACE_MS)
  ) {
    await markUnresolved(
      intent,
      "RECONCILIATION_REQUIRED",
      "No ledger receipt is available yet. This payment has not been reported as successful or failed.",
    );
    await recordAudit({
      actorId: intent.userId,
      action: AUDIT_ACTIONS.PAYMENT_RECONCILIATION_REQUIRED,
      entityType: "payment_intent",
      entityId: intent.id,
      metadata: { reason: "receipt_not_found" },
    });
  }

  return (await prisma.paymentIntent.findUnique({ where: { id: intent.id } })) ?? intent;
}

export async function getPaymentView(intentId: string, userId: string): Promise<PaymentView> {
  let intent = await loadIntent(intentId, userId);
  if (intent.status !== "SETTLED" && intent.status !== "REJECTED") {
    intent = (await reconcilePaymentIntent(intent)) as IntentWithTransaction;
    if (!intent.transaction) {
      intent = await loadIntent(intentId, userId);
    }
  }
  return toPaymentView(intent, intent.transaction);
}

/**
 * Recovers the durable intent created for a given client request. This is the
 * only safe answer after a timeout or a page refresh: the browser reuses its
 * original client request id and receives the same intent and ledger key.
 */
export async function getPaymentViewByClientRequestId(
  userId: string,
  clientRequestId: string,
): Promise<PaymentView> {
  const intent = await prisma.paymentIntent.findUnique({
    where: { userId_clientRequestId: { userId, clientRequestId } },
    include: { transaction: true },
  });
  if (!intent) {
    throw new ApiError(404, "PAYMENT_ERROR", "No payment matches that request reference.");
  }
  if (intent.status !== "SETTLED" && intent.status !== "REJECTED") {
    await reconcilePaymentIntent(intent, { force: true }).catch(() => intent);
  }
  const current =
    (await prisma.paymentIntent.findFirst({
      where: { id: intent.id, userId },
      include: { transaction: true },
    })) ?? intent;
  return toPaymentView(current, current.transaction);
}

export async function listRecentPaymentTransactions(userId: string, limit = 5) {
  const records = await prisma.transactionRecord.findMany({
    where: { userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return records;
}

export async function countUnresolvedPayments(userId: string): Promise<number> {
  return prisma.paymentIntent.count({
    where: {
      userId,
      status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
    },
  });
}

export async function assertNoUnresolvedPayments(userId: string): Promise<void> {
  const unresolved = await prisma.paymentIntent.findMany({
    where: {
      userId,
      status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (unresolved.length === 0) return;

  await Promise.all(
    unresolved.map((intent) => reconcilePaymentIntent(intent, { force: true }).catch(() => intent)),
  );

  const remaining = await countUnresolvedPayments(userId);
  if (remaining > 0) {
    throw new ApiError(
      409,
      "RECONCILIATION_REQUIRED",
      "A previous payment is still awaiting ledger confirmation. Open it to reconcile before starting a new payment.",
    );
  }
}

async function applySettlementReceipt(
  intent: PaymentIntent,
  receipt: RaftlineTransactionReceipt,
): Promise<PaymentView> {
  const verdict = verifySettlementReceipt(receipt, {
    idempotencyKey: intent.idempotencyKey,
    amountMinor: toSafeMinor(intent.amountMinor) ?? 0,
    currency: intent.currency,
    sourceAccountId: intent.sourceAccountId,
    destinationAccountId: intent.destinationAccountId,
  });

  if (verdict.type === "SETTLED") {
    return finalizeSettled(intent, verdict);
  }
  if (verdict.type === "REJECTED") {
    return finalizeRejected(intent, verdict.code, verdict.message, verdict.settledAt);
  }

  await markUnresolved(intent, "RECONCILIATION_REQUIRED", verdict.message);
  await recordAudit({
    actorId: intent.userId,
    action: AUDIT_ACTIONS.PAYMENT_RECONCILIATION_REQUIRED,
    entityType: "payment_intent",
    entityId: intent.id,
    metadata: { reason: "receipt_mismatch" },
  });
  const current = await loadIntent(intent.id, intent.userId);
  return toPaymentView(current, current.transaction);
}

async function finalizeSettled(
  intent: PaymentIntent,
  verdict: Extract<SettlementVerdict, { type: "SETTLED" }>,
): Promise<PaymentView> {
  const settledAt = verdict.settledAt;
  const source = await prisma.user.findUnique({
    where: { id: intent.userId },
    include: { profile: true },
  });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentIntent.updateMany({
      where: {
        id: intent.id,
        status: { in: ["CREATED", "PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      },
      data: {
        status: "SETTLED",
        paymentRef: verdict.paymentRef,
        raftLogIndex: verdict.raftLogIndex === null ? null : BigInt(verdict.raftLogIndex),
        receiptVerifiedAt: new Date(),
        lastWasIdempotentReplay: verdict.idempotentReplay,
        settledAt,
        rejectionCode: null,
        failureMessage: null,
        lastReconciledAt: new Date(),
      },
    });

    if (updated.count === 0) {
      const current = await tx.paymentIntent.findUnique({
        where: { id: intent.id },
        select: { status: true },
      });
      if (current?.status === "SETTLED") return;
      // A settled ledger receipt must never be hidden behind an earlier local
      // rejection. Preserve the conflict as unresolved instead of claiming
      // either success or failure until an operator reconciles it.
      await tx.paymentIntent.updateMany({
        where: { id: intent.id, status: "REJECTED" },
        data: {
          status: "RECONCILIATION_REQUIRED",
          failureMessage:
            "The ledger reported settlement for a payment recorded as rejected. Manual reconciliation is required.",
          receiptVerifiedAt: new Date(),
          lastWasIdempotentReplay: verdict.idempotentReplay,
          lastReconciledAt: new Date(),
        },
      });
      await tx.transactionRecord.updateMany({
        where: { paymentIntentId: intent.id, userId: intent.userId },
        data: { status: "RECONCILIATION_REQUIRED" },
      });
      return;
    }

    await tx.transactionRecord.updateMany({
      where: { paymentIntentId: intent.id, userId: intent.userId },
      data: {
        status: "SUCCESSFUL",
        paymentRef: verdict.paymentRef,
        balanceAfterMinor: BigInt(verdict.sourceBalanceAfter),
        occurredAt: settledAt,
      },
    });

    if (intent.recipientUserId) {
      const recipientWallet = await tx.wallet.findUnique({
        where: {
          userId_currency: { userId: intent.recipientUserId, currency: intent.currency },
        },
      });
      await tx.transactionRecord.upsert({
        where: {
          userId_paymentRef: {
            userId: intent.recipientUserId,
            paymentRef: verdict.paymentRef,
          },
        },
        create: {
          userId: intent.recipientUserId,
          walletId: recipientWallet?.id ?? null,
          kind: "P2P",
          direction: "RECEIVED",
          status: "SUCCESSFUL",
          amountMinor: intent.amountMinor,
          currency: intent.currency,
          counterpartyName: source?.profile?.displayName ?? "Nexus Pay customer",
          counterpartyUsername: source?.username ?? null,
          paymentRef: verdict.paymentRef,
          idempotencyKey: intent.idempotencyKey,
          description: intent.description,
          balanceAfterMinor: BigInt(verdict.destinationBalanceAfter),
          occurredAt: settledAt,
        },
        update: {
          status: "SUCCESSFUL",
          balanceAfterMinor: BigInt(verdict.destinationBalanceAfter),
          occurredAt: settledAt,
        },
      });
    }
  });

  await recordAudit({
    actorId: intent.userId,
    action: AUDIT_ACTIONS.PAYMENT_SETTLED,
    entityType: "payment_intent",
    entityId: intent.id,
    metadata: {
      paymentRef: verdict.paymentRef,
      idempotentReplay: verdict.idempotentReplay,
      raftLogIndex: verdict.raftLogIndex,
    },
  });

  const current = await loadIntent(intent.id, intent.userId);
  return toPaymentView(current, current.transaction);
}

async function finalizeRejected(
  intent: PaymentIntent,
  code: string,
  message: string,
  settledAt: Date | null,
): Promise<PaymentView> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentIntent.updateMany({
      where: {
        id: intent.id,
        status: { in: ["CREATED", "PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      },
      data: {
        status: "REJECTED",
        rejectionCode: code.slice(0, 80),
        failureMessage: message,
        receiptVerifiedAt: new Date(),
        settledAt: settledAt ?? null,
        lastReconciledAt: new Date(),
      },
    });
    if (updated.count === 0) return;

    await tx.transactionRecord.updateMany({
      where: {
        paymentIntentId: intent.id,
        userId: intent.userId,
        status: { notIn: ["SUCCESSFUL"] },
      },
      data: {
        status: "FAILED",
        occurredAt: settledAt ?? new Date(),
      },
    });
  });

  await recordAudit({
    actorId: intent.userId,
    action: AUDIT_ACTIONS.PAYMENT_REJECTED,
    entityType: "payment_intent",
    entityId: intent.id,
    metadata: { rejectionCode: code },
  });

  const current = await loadIntent(intent.id, intent.userId);
  return toPaymentView(current, current.transaction);
}

async function handleSettlementFailure(
  intent: PaymentIntent,
  error: unknown,
): Promise<PaymentView> {
  if (error instanceof RaftlineError) {
    if (error.code === "CONFLICT") {
      return finalizeRejected(
        intent,
        "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
        rejectionMessage("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"),
        null,
      );
    }
    if (error.code === "NOT_FOUND") {
      return finalizeRejected(
        intent,
        "ACCOUNT_NOT_FOUND",
        "A wallet linked to this payment could not be found. No money was sent.",
        null,
      );
    }
    if (error.code === "RATE_LIMITED") {
      // The ledger explicitly refused the request before execution. Return the
      // intent to an attemptable state and give back the claim so a few busy
      // responses cannot exhaust the automatic attempt budget.
      await prisma.$transaction(async (tx) => {
        const reset = await tx.paymentIntent.updateMany({
          where: {
            id: intent.id,
            userId: intent.userId,
            status: "PROCESSING",
            attemptCount: { gt: 0 },
          },
          data: {
            status: "CREATED",
            attemptCount: { decrement: 1 },
            failureMessage:
              "The ledger is busy. This payment was not executed. Retry when you are ready.",
          },
        });
        if (reset.count === 0) return;
        await tx.transactionRecord.updateMany({
          where: {
            paymentIntentId: intent.id,
            userId: intent.userId,
            status: { notIn: ["SUCCESSFUL"] },
          },
          data: { status: "PROCESSING" },
        });
      });
      return getPaymentView(intent.id, intent.userId);
    }
    if (error.code === "REQUEST_REJECTED" || error.code === "UNAUTHORIZED") {
      return finalizeRejected(
        intent,
        error.code,
        "The ledger rejected the payment request. No money was sent.",
        null,
      );
    }
  }

  await markUnresolved(
    intent,
    "UNKNOWN",
    "The ledger did not confirm this payment. Do not start a new payment; check this one again.",
  );
  await recordAudit({
    actorId: intent.userId,
    action: AUDIT_ACTIONS.PAYMENT_RECONCILIATION_REQUIRED,
    entityType: "payment_intent",
    entityId: intent.id,
    metadata: {
      reason: error instanceof RaftlineError ? error.code : "UNEXPECTED_ERROR",
    },
  });
  const current = await loadIntent(intent.id, intent.userId);
  return toPaymentView(current, current.transaction);
}

async function markUnresolved(
  intent: PaymentIntent,
  status: "UNKNOWN" | "RECONCILIATION_REQUIRED",
  message: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.paymentIntent.updateMany({
      where: {
        id: intent.id,
        status: { in: ["CREATED", "PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      },
      data: {
        status,
        failureMessage: message.slice(0, 500),
        lastReconciledAt: new Date(),
      },
    });
    if (updated.count === 0) return;
    await tx.transactionRecord.updateMany({
      where: {
        paymentIntentId: intent.id,
        userId: intent.userId,
        status: { notIn: ["SUCCESSFUL"] },
      },
      data: { status: "RECONCILIATION_REQUIRED" },
    });
  });
}

function mayAttempt(intent: PaymentIntent): boolean {
  if (intent.status === "CREATED") return true;
  if (intent.attemptCount >= MAX_AUTOMATIC_ATTEMPTS) return false;
  if (!intent.lastAttemptAt) return true;
  const age = Date.now() - intent.lastAttemptAt.getTime();
  if (intent.status === "PROCESSING") return age > IN_FLIGHT_GRACE_MS;
  return age > AMBIGUOUS_RETRY_GRACE_MS;
}

async function loadIntent(intentId: string, userId: string): Promise<IntentWithTransaction> {
  const intent = await prisma.paymentIntent.findFirst({
    where: {
      userId,
      OR: [{ id: intentId }, { paymentRef: intentId }],
    },
    include: { transaction: true },
  });
  if (!intent) {
    throw new ApiError(404, "PAYMENT_ERROR", "This payment could not be found.");
  }
  return intent;
}


