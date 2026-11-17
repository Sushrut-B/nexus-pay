import { randomUUID } from "node:crypto";
import { prisma, type PaymentRequest } from "@nexus/database";
import type {
  PaymentRequestStatus,
  RequestListResult,
  RequestSummary,
  RequestView,
} from "@nexus/shared-types";
import type { RequestCreateInput, RequestListQueryInput } from "@nexus/validation";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ApiError } from "@/lib/api/response";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { assertNotSelf } from "@/lib/social/contact-service";
import { createNotification, loadParty } from "@/lib/social/shared";

type IncludedUser = {
  id: string;
  username: string;
  fullName: string;
  profile: { displayName: string } | null;
};

type RequestWithRelations = PaymentRequest & {
  requester: IncludedUser;
  payer: IncludedUser;
  group: { name: string } | null;
};

function isExpired(request: { dueAt: Date | null }): boolean {
  return Boolean(request.dueAt && request.dueAt.getTime() <= Date.now());
}

async function loadRequest(userId: string, requestId: string): Promise<RequestWithRelations> {
  const request = await prisma.paymentRequest.findFirst({
    where: {
      id: requestId,
      OR: [{ requesterUserId: userId }, { payerUserId: userId }],
    },
    include: {
      requester: { include: { profile: true } },
      payer: { include: { profile: true } },
      group: { select: { name: true } },
    },
  });
  if (!request) {
    throw new ApiError(404, "PAYMENT_ERROR", "That payment request could not be found.");
  }

  if (request.status === "PENDING" && isExpired(request)) {
    await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return {
      ...request,
      status: "EXPIRED" as PaymentRequestStatus,
    };
  }
  return request as RequestWithRelations;
}

function toView(request: RequestWithRelations, viewerId: string): RequestView {
  const isPayer = request.payerUserId === viewerId;
  const isRequester = request.requesterUserId === viewerId;
  const pending = request.status === "PENDING" && !isExpired(request);
  return {
    id: request.id,
    requester: {
      userId: request.requester.id,
      displayName: request.requester.profile?.displayName ?? request.requester.fullName,
      username: request.requester.username,
    },
    payer: {
      userId: request.payer.id,
      displayName: request.payer.profile?.displayName ?? request.payer.fullName,
      username: request.payer.username,
    },
    amountMinor: Number(request.amountMinor),
    currency: request.currency,
    description: request.description,
    dueAt: request.dueAt?.toISOString() ?? null,
    status: request.status,
    paymentRef: request.paymentRef,
    groupId: request.groupId,
    groupName: request.group?.name ?? null,
    expenseId: request.expenseId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    paidAt: request.paidAt?.toISOString() ?? null,
    canAccept: isPayer && pending,
    canDecline: isPayer && pending,
    canCancel: isRequester && pending,
    canPay: isPayer && (pending || request.status === "ACCEPTED") && !isExpired(request),
  };
}

export async function createRequest(
  userId: string,
  input: RequestCreateInput,
): Promise<RequestView> {
  await assertNotSelf(userId, input.payerQuery);
  const recipient = await searchRecipient(userId, input.payerQuery);
  const payer = await prisma.user.findUnique({ where: { username: recipient.username } });
  if (!payer) {
    throw new ApiError(404, "RECIPIENT_NOT_FOUND", "No Nexus Pay customer matches that search.");
  }

  if (input.groupId) {
    const membership = await prisma.groupMember.findFirst({
      where: { groupId: input.groupId, userId, removedAt: null },
    });
    if (!membership) {
      throw new ApiError(403, "AUTHORIZATION_ERROR", "You are not a member of that group.");
    }
  }
  if (input.expenseId) {
    const expense = await prisma.expense.findFirst({
      where: { id: input.expenseId, groupId: input.groupId ?? undefined, deletedAt: null },
    });
    if (!expense) {
      throw new ApiError(404, "PAYMENT_ERROR", "That group expense could not be found.");
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.paymentRequest.create({
      data: {
        requesterUserId: userId,
        payerUserId: payer.id,
        amountMinor: BigInt(input.amountMinor),
        currency: input.currency,
        description: input.description ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        groupId: input.groupId ?? null,
        expenseId: input.expenseId ?? null,
        clientRequestId: randomUUID(),
      },
      include: {
        requester: { include: { profile: true } },
        payer: { include: { profile: true } },
        group: { select: { name: true } },
      },
    });
    const me = await loadParty(tx, userId);
    await createNotification(tx, {
      userId: payer.id,
      type: "PAYMENT_REQUEST_RECEIVED",
      title: `${me.displayName} requested money`,
      body: input.description ?? `A Nexus Pay request for ₹${(input.amountMinor / 100).toFixed(2)}`,
      data: { requestId: request.id, amountMinor: input.amountMinor },
    });
    return request;
  });

  await recordAudit({
    actorId: userId,
    action: AUDIT_ACTIONS.PAYMENT_INTENT_CREATED,
    entityType: "payment_request",
    entityId: created.id,
    metadata: { amountMinor: input.amountMinor, payerUserId: payer.id },
  });

  return toView(created as RequestWithRelations, userId);
}

export async function listRequests(
  userId: string,
  query: RequestListQueryInput,
): Promise<RequestListResult> {
  const where = {
    ...(query.direction === "received" ? { payerUserId: userId } : { requesterUserId: userId }),
    ...(query.status ? { status: query.status } : {}),
  };
  const [total, records] = await Promise.all([
    prisma.paymentRequest.count({ where }),
    prisma.paymentRequest.findMany({
      where,
      include: {
        requester: { include: { profile: true } },
        payer: { include: { profile: true } },
        group: { select: { name: true } },
      },
      orderBy: { createdAt: query.sort === "oldest" ? "asc" : "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    items: (records as RequestWithRelations[]).map((record) => toView(record, userId)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getRequest(userId: string, requestId: string): Promise<RequestView> {
  return toView(await loadRequest(userId, requestId), userId);
}

export async function getRequestSummary(userId: string): Promise<RequestSummary> {
  const [received, sent] = await Promise.all([
    prisma.paymentRequest.findMany({
      where: { payerUserId: userId, status: "PENDING" },
      select: { amountMinor: true, dueAt: true },
    }),
    prisma.paymentRequest.findMany({
      where: { requesterUserId: userId, status: "PENDING" },
      select: { amountMinor: true, dueAt: true },
    }),
  ]);
  const active = (items: Array<{ amountMinor: bigint; dueAt: Date | null }>) =>
    items.filter((item) => !item.dueAt || item.dueAt.getTime() > Date.now());
  const activeReceived = active(received);
  const activeSent = active(sent);
  return {
    receivedPendingCount: activeReceived.length,
    sentPendingCount: activeSent.length,
    receivedPendingMinor: activeReceived.reduce((sum, item) => sum + Number(item.amountMinor), 0),
    sentPendingMinor: activeSent.reduce((sum, item) => sum + Number(item.amountMinor), 0),
  };
}

async function transition(
  userId: string,
  requestId: string,
  expected: PaymentRequestStatus[],
  next: PaymentRequestStatus,
  actorIs: "payer" | "requester",
): Promise<RequestView> {
  const request = await loadRequest(userId, requestId);
  const allowed = actorIs === "payer" ? request.payerUserId === userId : request.requesterUserId === userId;
  if (!allowed) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "You cannot change this payment request.");
  }
  if (!expected.includes(request.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", `This request cannot be ${next.toLowerCase()} now.`);
  }
  await prisma.$transaction(async (tx) => {
    const result = await tx.paymentRequest.updateMany({
      where: { id: request.id, status: { in: expected } },
      data: { status: next },
    });
    if (result.count === 0) {
      throw new ApiError(409, "PAYMENT_ERROR", "This request changed while you were acting on it.");
    }
    await createNotification(tx, {
      userId: actorIs === "payer" ? request.requesterUserId : request.payerUserId,
      type: next === "ACCEPTED" ? "PAYMENT_REQUEST_ACCEPTED" : "PAYMENT_REQUEST_DECLINED",
      title:
        next === "ACCEPTED"
          ? "Your payment request was accepted"
          : "Your payment request was declined",
      body: `${request.requester.profile?.displayName ?? request.requester.fullName} · request ${request.id.slice(-6)}`,
      data: { requestId: request.id },
    });
  });

  // Reload after commit so the returned view reflects the new status.
  const updated = await loadRequest(userId, requestId);
  return toView(updated, userId);
}

export function acceptRequest(userId: string, requestId: string): Promise<RequestView> {
  return transition(userId, requestId, ["PENDING"], "ACCEPTED", "payer");
}

export function declineRequest(userId: string, requestId: string): Promise<RequestView> {
  return transition(userId, requestId, ["PENDING"], "DECLINED", "payer");
}

export function cancelRequest(userId: string, requestId: string): Promise<RequestView> {
  return transition(userId, requestId, ["PENDING"], "CANCELLED", "requester");
}

export async function payRequest(
  userId: string,
  requestId: string,
): Promise<{ request: RequestView; paymentStatus: string; failureMessage: string | null }> {
  const request = await loadRequest(userId, requestId);
  if (request.payerUserId !== userId) {
    throw new ApiError(403, "AUTHORIZATION_ERROR", "Only the person who received the request can pay it.");
  }
  if (!["PENDING", "ACCEPTED"].includes(request.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This request is no longer payable.");
  }
  if (isExpired(request)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This request has expired and cannot be paid.");
  }
  if (!request.clientRequestId) {
    throw new ApiError(409, "RECONCILIATION_REQUIRED", "This request has no durable payment reference.");
  }

  const recipient = await searchRecipient(userId, request.requester.username);
  const input = {
    clientRequestId: request.clientRequestId,
    recipientToken: recipient.recipientToken,
    amountMinor: Number(request.amountMinor),
    description: request.description ?? `Payment request ${request.id.slice(-6)}`,
  };

  const intent = await getOrCreatePaymentIntent(userId, input);
  const payment = await executePaymentIntent(intent.id, userId);

  if (payment.status === "SETTLED" && payment.paymentRef) {
    await prisma.$transaction(async (tx) => {
      await tx.paymentRequest.updateMany({
        where: { id: request.id, status: { in: ["PENDING", "ACCEPTED"] } },
        data: { status: "PAID", paymentRef: payment.paymentRef, paidAt: new Date() },
      });
      await createNotification(tx, {
        userId: request.requesterUserId,
        type: "PAYMENT_REQUEST_PAID",
        title: "A payment request was paid",
        body: `${request.payer.profile?.displayName ?? request.payer.fullName} paid the request.`,
        data: { requestId: request.id, paymentRef: payment.paymentRef },
      });
    });
  }

  const updated = await loadRequest(userId, requestId);
  return {
    request: toView(updated, userId),
    paymentStatus: payment.status,
    failureMessage: payment.failureMessage,
  };
}
