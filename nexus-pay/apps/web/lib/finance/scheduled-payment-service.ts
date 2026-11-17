import { prisma, type ScheduledPayment } from "@nexus/database";
import type {
  ExecutionStatus,
  ScheduleFrequency,
  ScheduledExecutionView,
  ScheduledPaymentView,
  ScheduleStatus,
} from "@nexus/shared-types";
import type { ScheduledPaymentCreateInput, ScheduledPaymentUpdateInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { toSocialParty } from "@/lib/social/shared";

const scheduleInclude = {
  recipient: { include: { profile: true } },
  executions: { orderBy: { scheduledFor: "desc" }, take: 1 },
} as const;

type ScheduleWithRelations = ScheduledPayment & {
  recipient: { id: string; username: string; fullName: string; profile: { displayName: string } | null };
  executions: Array<{
    id: string;
    executionKey: string;
    paymentRef: string | null;
    scheduledFor: Date;
    status: ExecutionStatus;
    attemptCount: number;
    lastErrorCode: string | null;
    executedAt: Date | null;
    createdAt: Date;
  }>;
};

export function computeNextExecution(from: Date, frequency: ScheduleFrequency): Date {
  const next = new Date(from);
  switch (frequency) {
    case "DAILY":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "WEEKLY":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "MONTHLY":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "QUARTERLY":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "YEARLY":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case "ONCE":
    default:
      break;
  }
  return next;
}

function toExecutionView(execution: ScheduleWithRelations["executions"][number]): ScheduledExecutionView {
  return {
    id: execution.id,
    executionKey: execution.executionKey,
    paymentRef: execution.paymentRef,
    scheduledFor: execution.scheduledFor.toISOString(),
    status: execution.status,
    attemptCount: execution.attemptCount,
    lastErrorCode: execution.lastErrorCode,
    executedAt: execution.executedAt?.toISOString() ?? null,
    createdAt: execution.createdAt.toISOString(),
  };
}

function toView(schedule: ScheduleWithRelations): ScheduledPaymentView {
  return {
    id: schedule.id,
    recipient: toSocialParty(schedule.recipient),
    amountMinor: Number(schedule.amountMinor),
    currency: schedule.currency,
    description: schedule.description,
    frequency: schedule.frequency,
    startDate: schedule.startDate.toISOString(),
    endDate: schedule.endDate?.toISOString() ?? null,
    nextExecutionAt: schedule.nextExecutionAt.toISOString(),
    maxExecutions: schedule.maxExecutions,
    executionCount: schedule.executionCount,
    status: schedule.status,
    lastExecution: schedule.executions[0] ? toExecutionView(schedule.executions[0]) : null,
    createdAt: schedule.createdAt.toISOString(),
  };
}

async function loadOwnedSchedule(userId: string, scheduleId: string): Promise<ScheduleWithRelations> {
  const schedule = await prisma.scheduledPayment.findFirst({
    where: { id: scheduleId, userId },
    include: scheduleInclude,
  });
  if (!schedule) {
    throw new ApiError(404, "AUTHORIZATION_ERROR", "That scheduled payment could not be found.");
  }
  return schedule as ScheduleWithRelations;
}

async function resolveRecipientWallet(userId: string, recipientQuery: string) {
  const summary = await searchRecipient(userId, recipientQuery);
  const recipient = await prisma.user.findUnique({ where: { username: summary.username } });
  if (!recipient) throw new ApiError(404, "RECIPIENT_NOT_FOUND", "No Nexus Pay customer matches that search.");
  const wallet = await prisma.wallet.findFirst({
    where: { userId: recipient.id, currency: "INR", status: "ACTIVE" },
  });
  if (!wallet?.raftlineAccountId) {
    throw new ApiError(409, "PAYMENT_ERROR", "That recipient cannot receive INR payments yet.");
  }
  const sourceWallet = await prisma.wallet.findFirst({
    where: { userId, currency: "INR", status: "ACTIVE" },
  });
  if (!sourceWallet?.raftlineAccountId) {
    throw new ApiError(409, "PAYMENT_ERROR", "Your INR wallet must be active before scheduling a payment.");
  }
  return { recipient, wallet, sourceWallet };
}

export async function createScheduledPayment(
  userId: string,
  input: ScheduledPaymentCreateInput,
): Promise<ScheduledPaymentView> {
  const { recipient, wallet, sourceWallet } = await resolveRecipientWallet(userId, input.recipientQuery);
  if (recipient.id === userId) {
    throw new ApiError(400, "PAYMENT_ERROR", "You cannot schedule a payment to yourself.");
  }
  const startDate = new Date(input.startDate);
  if (Number.isNaN(startDate.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", "The start date is invalid.");
  }

  const schedule = await prisma.scheduledPayment.create({
    data: {
      userId,
      recipientUserId: recipient.id,
      sourceWalletId: sourceWallet.id,
      destinationWalletId: wallet.id,
      amountMinor: BigInt(input.amountMinor),
      currency: input.currency,
      description: input.description ?? null,
      frequency: input.frequency,
      startDate,
      endDate: input.endDate ? new Date(input.endDate) : null,
      nextExecutionAt: startDate,
      maxExecutions: input.maxExecutions ?? null,
      status: "ACTIVE",
    },
    include: scheduleInclude,
  });
  return toView(schedule as ScheduleWithRelations);
}

export async function listScheduledPayments(userId: string): Promise<ScheduledPaymentView[]> {
  const schedules = await prisma.scheduledPayment.findMany({
    where: { userId },
    include: scheduleInclude,
    orderBy: [{ status: "asc" }, { nextExecutionAt: "asc" }],
  });
  return (schedules as ScheduleWithRelations[]).map(toView);
}

export async function getScheduledPayment(userId: string, scheduleId: string): Promise<ScheduledPaymentView> {
  return toView(await loadOwnedSchedule(userId, scheduleId));
}

export async function listExecutions(
  userId: string,
  scheduleId: string,
): Promise<ScheduledExecutionView[]> {
  await loadOwnedSchedule(userId, scheduleId);
  const executions = await prisma.scheduledPaymentExecution.findMany({
    where: { scheduledPaymentId: scheduleId },
    orderBy: { scheduledFor: "desc" },
    take: 100,
  });
  return executions.map((execution) => toExecutionView(execution as ScheduleWithRelations["executions"][number]));
}

export async function updateScheduledPayment(
  userId: string,
  scheduleId: string,
  input: ScheduledPaymentUpdateInput,
): Promise<ScheduledPaymentView> {
  const schedule = await loadOwnedSchedule(userId, scheduleId);
  if (!["DRAFT", "ACTIVE", "PAUSED", "REQUIRES_ATTENTION"].includes(schedule.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This schedule can no longer be edited.");
  }
  const updated = await prisma.scheduledPayment.update({
    where: { id: scheduleId },
    data: {
      amountMinor: input.amountMinor === undefined ? undefined : BigInt(input.amountMinor),
      description: input.description === null ? null : input.description,
      frequency: input.frequency,
      endDate: input.endDate === null ? null : input.endDate ? new Date(input.endDate) : undefined,
      maxExecutions: input.maxExecutions === null ? null : input.maxExecutions,
    },
    include: scheduleInclude,
  });
  return toView(updated as ScheduleWithRelations);
}

async function transition(userId: string, scheduleId: string, status: ScheduleStatus): Promise<ScheduledPaymentView> {
  const schedule = await loadOwnedSchedule(userId, scheduleId);
  if (schedule.status === status) return toView(schedule);
  const allowed: Record<ScheduleStatus, ScheduleStatus[]> = {
    DRAFT: ["ACTIVE", "CANCELLED"],
    ACTIVE: ["PAUSED", "CANCELLED", "REQUIRES_ATTENTION"],
    PAUSED: ["ACTIVE", "CANCELLED"],
    PROCESSING: ["PAUSED", "CANCELLED", "REQUIRES_ATTENTION"],
    COMPLETED: [],
    FAILED: ["ACTIVE", "CANCELLED"],
    CANCELLED: [],
    REQUIRES_ATTENTION: ["ACTIVE", "PAUSED", "CANCELLED"],
  };
  if (!allowed[schedule.status].includes(status)) {
    throw new ApiError(409, "PAYMENT_ERROR", `This schedule cannot move to ${status}.`);
  }
  const updated = await prisma.scheduledPayment.update({
    where: { id: scheduleId },
    data: { status },
    include: scheduleInclude,
  });
  return toView(updated as ScheduleWithRelations);
}

export const pauseScheduledPayment = (userId: string, scheduleId: string) =>
  transition(userId, scheduleId, "PAUSED");
export const resumeScheduledPayment = (userId: string, scheduleId: string) =>
  transition(userId, scheduleId, "ACTIVE");
export const cancelScheduledPayment = (userId: string, scheduleId: string) =>
  transition(userId, scheduleId, "CANCELLED");

export async function deleteScheduledPayment(userId: string, scheduleId: string): Promise<void> {
  const schedule = await loadOwnedSchedule(userId, scheduleId);
  if (schedule.executionCount > 0 && schedule.status !== "CANCELLED") {
    throw new ApiError(409, "PAYMENT_ERROR", "Cancel the schedule before deleting it.");
  }
  await prisma.scheduledPayment.delete({ where: { id: scheduleId } });
}
