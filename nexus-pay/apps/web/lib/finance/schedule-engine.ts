import { prisma } from "@nexus/database";
import type { ScheduleStatus } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { createNotification, loadParty } from "@/lib/social/shared";
import { computeNextExecution } from "@/lib/finance/scheduled-payment-service";

/** Retry policy: ambiguous outcomes retry; definitive rejections do not. */
export const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 60_000;

const NON_RETRYABLE_CODES = new Set([
  "INSUFFICIENT_FUNDS",
  "SOURCE_ACCOUNT_NOT_FOUND",
  "DESTINATION_ACCOUNT_NOT_FOUND",
  "SOURCE_ACCOUNT_FROZEN",
  "SOURCE_ACCOUNT_SUSPENDED",
  "DESTINATION_ACCOUNT_FROZEN",
  "DESTINATION_ACCOUNT_SUSPENDED",
  "CURRENCY_MISMATCH",
  "INVALID_AMOUNT_MUST_BE_POSITIVE",
  "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
  "ACCOUNT_NOT_FOUND",
]);

export interface RunResult {
  processed: number;
  settled: number;
  failed: number;
  skipped: number;
}

/**
 * Process one due schedule occurrence. The execution key is stable for the
 * occurrence, and the payment intent reuses that same key, so a retry, a second
 * worker or a crash can never create a second debit.
 */
export async function processDueSchedule(scheduleId: string): Promise<"settled" | "failed" | "skipped" | "attention"> {
  const schedule = await prisma.scheduledPayment.findUnique({
    where: { id: scheduleId },
    include: { recipient: { include: { profile: true } } },
  });
  if (!schedule || schedule.status !== "ACTIVE") return "skipped";

  const scheduledFor = new Date(schedule.nextExecutionAt);
  const executionKey = `${schedule.id}:${scheduledFor.toISOString()}`;

  const existing = await prisma.scheduledPaymentExecution.findUnique({
    where: { executionKey },
  });
  const execution =
    existing ??
    (await prisma.scheduledPaymentExecution.create({
      data: {
        scheduledPaymentId: schedule.id,
        executionKey,
        scheduledFor,
        status: "PENDING",
      },
    }));

  // Atomic claim: only one worker can move PENDING/RETRY_PENDING to PROCESSING.
  const now = new Date();
  const claimed = await prisma.scheduledPaymentExecution.updateMany({
    where: {
      id: execution.id,
      status: { in: ["PENDING", "RETRY_PENDING"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: "PROCESSING",
      attemptCount: { increment: 1 },
      executedAt: null,
    },
  });
  if (claimed.count === 0) return "skipped";

  const attemptCount = execution.attemptCount + 1;

  try {
    const recipient = await searchRecipient(schedule.userId, schedule.recipient.username);
    const intent = await getOrCreatePaymentIntent(schedule.userId, {
      clientRequestId: executionKey,
      recipientToken: recipient.recipientToken,
      amountMinor: Number(schedule.amountMinor),
      description: schedule.description ?? `Scheduled payment ${schedule.id.slice(-6)}`,
    });
    const payment = await executePaymentIntent(intent.id, schedule.userId);

    if (payment.status === "SETTLED" && payment.paymentRef) {
      await prisma.$transaction(async (tx) => {
        await tx.scheduledPaymentExecution.update({
          where: { id: execution.id },
          data: { status: "SETTLED", paymentRef: payment.paymentRef, executedAt: new Date() },
        });
        const nextCount = schedule.executionCount + 1;
        const next = computeNextExecution(scheduledFor, schedule.frequency);
        const reachedMax = schedule.maxExecutions !== null && nextCount >= schedule.maxExecutions;
        const reachedEnd = schedule.endDate !== null && next > schedule.endDate;
        const completed = schedule.frequency === "ONCE" || reachedMax || reachedEnd;
        await tx.scheduledPayment.update({
          where: { id: schedule.id },
          data: {
            executionCount: nextCount,
            status: completed ? "COMPLETED" : "ACTIVE",
            nextExecutionAt: completed ? scheduledFor : next,
          },
        });
        const me = await loadParty(tx, schedule.userId);
        await createNotification(tx, {
          userId: schedule.userId,
          type: "SCHEDULED_PAYMENT_COMPLETED",
          title: "Scheduled payment completed",
          body: `${me.displayName} paid ${schedule.recipient.profile?.displayName ?? schedule.recipient.fullName} ${payment.amountMinor / 100} INR.`,
          data: { scheduleId: schedule.id, executionId: execution.id },
        });
        await createNotification(tx, {
          userId: schedule.recipientUserId,
          type: "SCHEDULED_PAYMENT_COMPLETED",
          title: "A scheduled payment arrived",
          body: `${me.displayName} sent you a scheduled payment.`,
          data: { scheduleId: schedule.id, executionId: execution.id },
        });
      });
      return "settled";
    }

    const rejectionCode = payment.rejectionCode ?? "PAYMENT_REJECTED";
    if (payment.status === "REJECTED" && NON_RETRYABLE_CODES.has(rejectionCode)) {
      await prisma.$transaction(async (tx) => {
        await tx.scheduledPaymentExecution.update({
          where: { id: execution.id },
          data: { status: "FAILED", lastErrorCode: rejectionCode, executedAt: new Date() },
        });
        await tx.scheduledPayment.update({ where: { id: schedule.id }, data: { status: "REQUIRES_ATTENTION" } });
        await createNotification(tx, {
          userId: schedule.userId,
          type: "SCHEDULED_PAYMENT_ATTENTION",
          title: "Scheduled payment needs attention",
          body: payment.failureMessage ?? "The scheduled payment was rejected and did not move money.",
          data: { scheduleId: schedule.id, executionId: execution.id },
        });
      });
      return "attention";
    }

    // Ambiguous or retryable: preserve the same execution and payment intent.
    if (attemptCount < MAX_ATTEMPTS) {
      await prisma.scheduledPaymentExecution.update({
        where: { id: execution.id },
        data: {
          status: "RETRY_PENDING",
          lastErrorCode: payment.status === "REJECTED" ? rejectionCode : payment.status,
          nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS * attemptCount),
        },
      });
      return "failed";
    }

    await prisma.$transaction(async (tx) => {
      await tx.scheduledPaymentExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          lastErrorCode: payment.status === "REJECTED" ? rejectionCode : payment.status,
          executedAt: new Date(),
        },
      });
      await tx.scheduledPayment.update({ where: { id: schedule.id }, data: { status: "REQUIRES_ATTENTION" } });
      await createNotification(tx, {
        userId: schedule.userId,
        type: "SCHEDULED_PAYMENT_FAILED",
        title: "Scheduled payment failed",
        body: payment.failureMessage ?? "The scheduled payment could not be completed.",
        data: { scheduleId: schedule.id, executionId: execution.id },
      });
    });
    return "failed";
  } catch (error) {
    const code = error instanceof ApiError ? error.category : "UNEXPECTED_ERROR";
    if (attemptCount < MAX_ATTEMPTS) {
      await prisma.scheduledPaymentExecution.update({
        where: { id: execution.id },
        data: { status: "RETRY_PENDING", lastErrorCode: code, nextAttemptAt: new Date(Date.now() + RETRY_BACKOFF_MS * attemptCount) },
      });
      return "failed";
    }
    await prisma.$transaction(async (tx) => {
      await tx.scheduledPaymentExecution.update({
        where: { id: execution.id },
        data: { status: "FAILED", lastErrorCode: code, executedAt: new Date() },
      });
      await tx.scheduledPayment.update({ where: { id: schedule.id }, data: { status: "REQUIRES_ATTENTION" } });
      await createNotification(tx, {
        userId: schedule.userId,
        type: "SCHEDULED_PAYMENT_ATTENTION",
        title: "Scheduled payment needs attention",
        body: "The scheduled payment could not be confirmed. Check the schedule before retrying.",
        data: { scheduleId: schedule.id, executionId: execution.id },
      });
    });
    return "attention";
  }
}

/** Claim and process every active schedule whose next execution time has arrived. */
export async function runDueExecutions(limit = 25): Promise<RunResult> {
  const due = await prisma.scheduledPayment.findMany({
    where: { status: "ACTIVE", nextExecutionAt: { lte: new Date() } },
    orderBy: { nextExecutionAt: "asc" },
    take: limit,
  });

  const result: RunResult = { processed: 0, settled: 0, failed: 0, skipped: 0 };
  for (const schedule of due) {
    try {
      const outcome = await processDueSchedule(schedule.id);
      result.processed += 1;
      if (outcome === "settled") result.settled += 1;
      else if (outcome === "skipped") result.skipped += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export async function getScheduleStatus(scheduleId: string): Promise<ScheduleStatus | null> {
  const schedule = await prisma.scheduledPayment.findUnique({ where: { id: scheduleId }, select: { status: true } });
  return schedule?.status ?? null;
}
