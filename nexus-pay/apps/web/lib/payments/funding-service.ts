import { randomUUID } from "node:crypto";
import {
  createRaftlineClient,
  RaftlineError,
  type RaftlinePaymentsClient,
  type RaftlineTransactionReceipt,
} from "@nexus/api-client";
import { Prisma, prisma, type FundingOperation, type TransactionRecord } from "@nexus/database";
import type { FundingView } from "@nexus/shared-types";
import type { FundingRequestInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { toFundingView, toSafeMinor } from "@/lib/payments/dto";
import { withLedgerAccountLocks } from "@/lib/payments/ledger-lock";
import { verifyFundingReceipt, type FundingVerdict } from "@/lib/payments/verify";

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

type FundingWithTransaction = FundingOperation & { transaction: TransactionRecord | null };

export async function getOrCreateFundingOperation(
  userId: string,
  input: FundingRequestInput,
): Promise<FundingView> {
  const existing = await prisma.fundingOperation.findUnique({
    where: {
      userId_clientRequestId: {
        userId,
        clientRequestId: input.clientRequestId,
      },
    },
    include: { transaction: true },
  });
  if (existing) return toFundingView(existing, existing.transaction);

  const wallet = await prisma.wallet.findFirst({
    where: { userId, currency: "INR" },
  });
  if (!wallet || wallet.status !== "ACTIVE" || !wallet.raftlineAccountId) {
    throw new ApiError(
      409,
      "PAYMENT_ERROR",
      "Your INR wallet must be active before you can add simulated funds.",
    );
  }

  await assertNoUnresolvedFunding(userId);
  const idempotencyKey = `np_fund_${randomUUID().replace(/-/g, "")}`;

  try {
    const operation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${wallet.id} FOR UPDATE`;

      const raced = await tx.fundingOperation.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
        include: { transaction: true },
      });
      if (raced) return raced;

      const unresolved = await tx.fundingOperation.count({
        where: {
          userId,
          status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
        },
      });
      if (unresolved > 0) {
        throw new ApiError(
          409,
          "RECONCILIATION_REQUIRED",
          "A previous simulated funding request still needs ledger confirmation. Reconcile it before adding more.",
        );
      }

      return tx.fundingOperation.create({
        data: {
          userId,
          walletId: wallet.id,
          clientRequestId: input.clientRequestId,
          idempotencyKey,
          amountMinor: BigInt(input.amountMinor),
          currency: "INR",
          raftlineAccountId: wallet.raftlineAccountId!,
          transaction: {
            create: {
              userId,
              walletId: wallet.id,
              kind: "FUNDING",
              direction: "RECEIVED",
              status: "PROCESSING",
              amountMinor: BigInt(input.amountMinor),
              currency: "INR",
              counterpartyName: "Simulated sandbox funding",
              idempotencyKey,
              description: "SIMULATED SANDBOX FUNDING",
              occurredAt: new Date(),
            },
          },
        },
        include: { transaction: true },
      });
    });

    await recordAudit({
      actorId: userId,
      action: AUDIT_ACTIONS.FUNDING_OPERATION_CREATED,
      entityType: "funding_operation",
      entityId: operation.id,
      metadata: {
        amountMinor: input.amountMinor,
        currency: "INR",
        simulated: true,
        idempotencyKey,
      },
    });

    return toFundingView(operation, operation.transaction);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.fundingOperation.findUnique({
        where: {
          userId_clientRequestId: {
            userId,
            clientRequestId: input.clientRequestId,
          },
        },
        include: { transaction: true },
      });
      if (raced) return toFundingView(raced, raced.transaction);
    }
    throw error;
  }
}

export async function executeFundingOperation(
  operationId: string,
  userId: string,
): Promise<FundingView> {
  let operation = await loadFunding(operationId, userId);
  if (operation.status === "COMPLETED" || operation.status === "FAILED") {
    return toFundingView(operation, operation.transaction);
  }

  if (operation.status !== "CREATED" || operation.attemptCount > 0) {
    await reconcileFundingOperation(operation, { force: true });
    operation = await loadFunding(operationId, userId);
    if (operation.status === "COMPLETED" || operation.status === "FAILED") {
      return toFundingView(operation, operation.transaction);
    }
    if (!mayAttempt(operation)) {
      return toFundingView(operation, operation.transaction);
    }
  }

  const now = new Date();
  const claimed = await prisma.fundingOperation.updateMany({
    where: {
      id: operation.id,
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
    const current = await loadFunding(operationId, userId);
    if (
      current.status === "PROCESSING" &&
      current.lastAttemptAt &&
      Date.now() - current.lastAttemptAt.getTime() > IN_FLIGHT_GRACE_MS
    ) {
      await reconcileFundingOperation(current, { force: true });
      return getFundingView(operationId, userId);
    }
    return toFundingView(current, current.transaction);
  }

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.FUNDING_ATTEMPT_STARTED,
    entityType: "funding_operation",
    entityId: operation.id,
    metadata: {
      attempt: operation.attemptCount + 1,
      idempotencyKey: operation.idempotencyKey,
      simulated: true,
    },
  });

  try {
    const result = await withLedgerAccountLocks([operation.raftlineAccountId], () =>
      getRaftlineClient().fundAccount({
        accountId: operation.raftlineAccountId,
        amountCents: toSafeMinor(operation.amountMinor) ?? 0,
        idempotencyKey: operation.idempotencyKey,
        currency: operation.currency,
      }),
    );

    if (!result.receipt) {
      await markFundingUnresolved(
        operation,
        "UNKNOWN",
        "The ledger accepted the funding request, but no receipt could be read back yet. No success has been reported.",
      );
      const current = await loadFunding(operation.id, userId);
      return toFundingView(current, current.transaction);
    }
    return await applyFundingReceipt(operation, result.receipt);
  } catch (error) {
    return handleFundingFailure(operation, error);
  }
}

export async function reconcileFundingOperation(
  operation: FundingOperation,
  options: { force?: boolean } = {},
): Promise<FundingOperation> {
  if (operation.status === "COMPLETED" || operation.status === "FAILED") return operation;

  const minIntervalMs = getServerEnv().PAYMENT_RECONCILIATION_MIN_INTERVAL_SECONDS * 1000;
  if (
    !options.force &&
    operation.lastReconciledAt &&
    Date.now() - operation.lastReconciledAt.getTime() < minIntervalMs
  ) {
    return operation;
  }

  await prisma.fundingOperation.updateMany({
    where: { id: operation.id, status: { notIn: ["COMPLETED", "FAILED"] } },
    data: { lastReconciledAt: new Date() },
  });

  let receipt: RaftlineTransactionReceipt | null;
  try {
    receipt = await getRaftlineClient().getTransaction(operation.idempotencyKey);
  } catch {
    return (await prisma.fundingOperation.findUnique({ where: { id: operation.id } })) ?? operation;
  }

  if (receipt) {
    const updated = await applyFundingReceipt(operation, receipt);
    return (await prisma.fundingOperation.findUnique({ where: { id: updated.id } })) ?? operation;
  }

  if (
    operation.status === "UNKNOWN" ||
    operation.status === "RECONCILIATION_REQUIRED" ||
    (operation.status === "PROCESSING" &&
      operation.lastAttemptAt &&
      Date.now() - operation.lastAttemptAt.getTime() > AMBIGUOUS_RETRY_GRACE_MS)
  ) {
    await markFundingUnresolved(
      operation,
      "RECONCILIATION_REQUIRED",
      "No funding receipt is available yet. This sandbox credit has not been reported as successful or failed.",
    );
    await recordAudit({
      actorId: operation.userId,
      action: AUDIT_ACTIONS.FUNDING_RECONCILIATION_REQUIRED,
      entityType: "funding_operation",
      entityId: operation.id,
      metadata: { reason: "receipt_not_found", simulated: true },
    });
  }

  return (await prisma.fundingOperation.findUnique({ where: { id: operation.id } })) ?? operation;
}

export async function getFundingView(
  operationId: string,
  userId: string,
): Promise<FundingView> {
  let operation = await loadFunding(operationId, userId);
  if (operation.status !== "COMPLETED" && operation.status !== "FAILED") {
    operation = (await reconcileFundingOperation(operation)) as FundingWithTransaction;
    if (!operation.transaction) {
      operation = await loadFunding(operationId, userId);
    }
  }
  return toFundingView(operation, operation.transaction);
}

/**
 * Recovers the durable funding operation for a given client request without
 * ever issuing a second credit or generating a new idempotency key.
 */
export async function getFundingViewByClientRequestId(
  userId: string,
  clientRequestId: string,
): Promise<FundingView> {
  const operation = await prisma.fundingOperation.findUnique({
    where: { userId_clientRequestId: { userId, clientRequestId } },
    include: { transaction: true },
  });
  if (!operation) {
    throw new ApiError(404, "PAYMENT_ERROR", "No simulated funding request matches that reference.");
  }
  if (operation.status !== "COMPLETED" && operation.status !== "FAILED") {
    await reconcileFundingOperation(operation, { force: true }).catch(() => operation);
  }
  const current =
    (await prisma.fundingOperation.findFirst({
      where: { id: operation.id, userId },
      include: { transaction: true },
    })) ?? operation;
  return toFundingView(current, current.transaction);
}

export async function countUnresolvedFunding(userId: string): Promise<number> {
  return prisma.fundingOperation.count({
    where: {
      userId,
      status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
    },
  });
}

export async function assertNoUnresolvedFunding(userId: string): Promise<void> {
  const unresolved = await prisma.fundingOperation.findMany({
    where: {
      userId,
      status: { in: ["PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  if (unresolved.length === 0) return;

  await Promise.all(
    unresolved.map((operation) =>
      reconcileFundingOperation(operation, { force: true }).catch(() => operation),
    ),
  );

  if ((await countUnresolvedFunding(userId)) > 0) {
    throw new ApiError(
      409,
      "RECONCILIATION_REQUIRED",
      "A previous simulated funding request is still awaiting ledger confirmation. Open it before adding more.",
    );
  }
}

async function applyFundingReceipt(
  operation: FundingOperation,
  receipt: RaftlineTransactionReceipt,
): Promise<FundingView> {
  const verdict = verifyFundingReceipt(receipt, {
    idempotencyKey: operation.idempotencyKey,
    amountMinor: toSafeMinor(operation.amountMinor) ?? 0,
    currency: operation.currency,
    accountId: operation.raftlineAccountId,
  });

  if (verdict.type === "COMPLETED") {
    return finalizeCompleted(operation, verdict);
  }
  if (verdict.type === "FAILED") {
    return finalizeFailed(operation, verdict.code, verdict.message);
  }

  await markFundingUnresolved(operation, "RECONCILIATION_REQUIRED", verdict.message);
  await recordAudit({
    actorId: operation.userId,
    action: AUDIT_ACTIONS.FUNDING_RECONCILIATION_REQUIRED,
    entityType: "funding_operation",
    entityId: operation.id,
    metadata: { reason: "receipt_mismatch", simulated: true },
  });
  const current = await loadFunding(operation.id, operation.userId);
  return toFundingView(current, current.transaction);
}

async function finalizeCompleted(
  operation: FundingOperation,
  verdict: Extract<FundingVerdict, { type: "COMPLETED" }>,
): Promise<FundingView> {
  const completedAt = verdict.settledAt;
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fundingOperation.updateMany({
      where: {
        id: operation.id,
        status: { in: ["CREATED", "PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      },
      data: {
        status: "COMPLETED",
        fundingRef: verdict.fundingRef,
        balanceAfterMinor: BigInt(verdict.balanceAfterMinor),
        receiptVerifiedAt: new Date(),
        lastWasIdempotentReplay: verdict.idempotentReplay,
        completedAt,
        failureCode: null,
        failureMessage: null,
        lastReconciledAt: new Date(),
      },
    });
    if (updated.count === 0) {
      const current = await tx.fundingOperation.findUnique({
        where: { id: operation.id },
        select: { status: true },
      });
      if (current?.status === "COMPLETED") return;
      await tx.fundingOperation.updateMany({
        where: { id: operation.id, status: "FAILED" },
        data: {
          status: "RECONCILIATION_REQUIRED",
          failureMessage:
            "The ledger reported a completed funding operation for a request recorded as failed. Manual reconciliation is required.",
          receiptVerifiedAt: new Date(),
          lastWasIdempotentReplay: verdict.idempotentReplay,
          lastReconciledAt: new Date(),
        },
      });
      await tx.transactionRecord.updateMany({
        where: { fundingOperationId: operation.id, userId: operation.userId },
        data: { status: "RECONCILIATION_REQUIRED" },
      });
      return;
    }

    await tx.transactionRecord.updateMany({
      where: { fundingOperationId: operation.id, userId: operation.userId },
      data: {
        status: "SUCCESSFUL",
        paymentRef: verdict.fundingRef,
        balanceAfterMinor: BigInt(verdict.balanceAfterMinor),
        occurredAt: completedAt,
      },
    });
  });

  await recordAudit({
    actorId: operation.userId,
    action: AUDIT_ACTIONS.FUNDING_COMPLETED,
    entityType: "funding_operation",
    entityId: operation.id,
    metadata: {
      fundingRef: verdict.fundingRef,
      amountMinor: toSafeMinor(operation.amountMinor),
      balanceAfterMinor: verdict.balanceAfterMinor,
      idempotentReplay: verdict.idempotentReplay,
      simulated: true,
    },
  });

  const current = await loadFunding(operation.id, operation.userId);
  return toFundingView(current, current.transaction);
}

async function finalizeFailed(
  operation: FundingOperation,
  code: string,
  message: string,
): Promise<FundingView> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fundingOperation.updateMany({
      where: {
        id: operation.id,
        status: { in: ["CREATED", "PROCESSING", "UNKNOWN", "RECONCILIATION_REQUIRED"] },
      },
      data: {
        status: "FAILED",
        failureCode: code.slice(0, 80),
        failureMessage: message,
        receiptVerifiedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    if (updated.count === 0) return;
    await tx.transactionRecord.updateMany({
      where: {
        fundingOperationId: operation.id,
        userId: operation.userId,
        status: { notIn: ["SUCCESSFUL"] },
      },
      data: { status: "FAILED", occurredAt: new Date() },
    });
  });

  await recordAudit({
    actorId: operation.userId,
    action: AUDIT_ACTIONS.FUNDING_FAILED,
    entityType: "funding_operation",
    entityId: operation.id,
    metadata: { failureCode: code, simulated: true },
  });

  const current = await loadFunding(operation.id, operation.userId);
  return toFundingView(current, current.transaction);
}

async function handleFundingFailure(
  operation: FundingOperation,
  error: unknown,
): Promise<FundingView> {
  if (error instanceof RaftlineError) {
    if (error.code === "CONFLICT") {
      return finalizeFailed(
        operation,
        "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
        "This simulated funding reference was already used for a different amount.",
      );
    }
    if (error.code === "NOT_FOUND") {
      return finalizeFailed(
        operation,
        "ACCOUNT_NOT_FOUND",
        "Your ledger account could not be found. No simulated funds were added.",
      );
    }
    if (error.code === "RATE_LIMITED") {
      await prisma.$transaction(async (tx) => {
        const reset = await tx.fundingOperation.updateMany({
          where: {
            id: operation.id,
            userId: operation.userId,
            status: "PROCESSING",
            attemptCount: { gt: 0 },
          },
          data: {
            status: "CREATED",
            attemptCount: { decrement: 1 },
            failureMessage:
              "The ledger is busy. No simulated funds were added. Retry when you are ready.",
          },
        });
        if (reset.count === 0) return;
        await tx.transactionRecord.updateMany({
          where: {
            fundingOperationId: operation.id,
            userId: operation.userId,
            status: { notIn: ["SUCCESSFUL"] },
          },
          data: { status: "PROCESSING" },
        });
      });
      return getFundingView(operation.id, operation.userId);
    }
    if (error.code === "REQUEST_REJECTED" || error.code === "UNAUTHORIZED") {
      return finalizeFailed(
        operation,
        error.code,
        "The ledger rejected the simulated funding request. No funds were added.",
      );
    }
  }

  await markFundingUnresolved(
    operation,
    "UNKNOWN",
    "The ledger did not confirm this simulated funding. Check again before starting another.",
  );
  await recordAudit({
    actorId: operation.userId,
    action: AUDIT_ACTIONS.FUNDING_RECONCILIATION_REQUIRED,
    entityType: "funding_operation",
    entityId: operation.id,
    metadata: {
      reason: error instanceof RaftlineError ? error.code : "UNEXPECTED_ERROR",
      simulated: true,
    },
  });
  const current = await loadFunding(operation.id, operation.userId);
  return toFundingView(current, current.transaction);
}

async function markFundingUnresolved(
  operation: FundingOperation,
  status: "UNKNOWN" | "RECONCILIATION_REQUIRED",
  message: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fundingOperation.updateMany({
      where: {
        id: operation.id,
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
        fundingOperationId: operation.id,
        userId: operation.userId,
        status: { notIn: ["SUCCESSFUL"] },
      },
      data: { status: "RECONCILIATION_REQUIRED" },
    });
  });
}

function mayAttempt(operation: FundingOperation): boolean {
  if (operation.status === "CREATED") return true;
  if (operation.attemptCount >= MAX_AUTOMATIC_ATTEMPTS) return false;
  if (!operation.lastAttemptAt) return true;
  const age = Date.now() - operation.lastAttemptAt.getTime();
  if (operation.status === "PROCESSING") return age > IN_FLIGHT_GRACE_MS;
  return age > AMBIGUOUS_RETRY_GRACE_MS;
}

async function loadFunding(
  operationId: string,
  userId: string,
): Promise<FundingWithTransaction> {
  const operation = await prisma.fundingOperation.findFirst({
    where: {
      userId,
      OR: [{ id: operationId }, { fundingRef: operationId }],
    },
    include: { transaction: true },
  });
  if (!operation) {
    throw new ApiError(404, "PAYMENT_ERROR", "This simulated funding request could not be found.");
  }
  return operation;
}
