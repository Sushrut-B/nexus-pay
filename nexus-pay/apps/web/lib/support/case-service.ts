/**
 * Release 19 — durable support case lifecycle.
 *
 * Support status is independent of financial status. Linked operations are
 * resolved and ownership-checked by link-service and only ever read.
 */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type {
  SupportCaseStatus, SupportCaseView, SupportCaseDetailView, SupportPriority,
  SupportCategory, SupportLinkType,
} from "@nexus/shared-types";
import {
  CASE_TRANSITIONS, SUPPORT_NOTICE, categoryOption, defaultNextAction,
  ESCALATION_SIGNALS, isSensitiveText,
} from "@/lib/support/support-constants";
import { resolveLink, refreshAuthoritativeStatus } from "@/lib/support/link-service";
import {
  notifySupport, publishSupportSecurity, recordSupportAudit, supportSecurityAudit,
} from "@/lib/support/support-audit";

const CUSTOMER_RAISED = "CUSTOMER";
const STAFF_RAISED = "STAFF";

function makeReference(): string {
  return `SC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function initialPriority(category: SupportCategory, description: string): SupportPriority {
  if (category === "UNAUTHORIZED_ACTIVITY") return "HIGH";
  if (/balance|missing|duplicate|debit/i.test(description) && category.startsWith("PAYMENT_")) return "HIGH";
  return "NORMAL";
}

async function appendEvent(input: {
  caseId: string; kind: string; detail: string;
  actorType: string; actorId: string; actorLabel: string;
  customerVisible?: boolean;
}) {
  await prisma.supportCaseEvent.create({
    data: {
      caseId: input.caseId,
      kind: input.kind,
      detail: input.detail.slice(0, 900),
      actorType: input.actorType,
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      customerVisible: input.customerVisible ?? true,
    },
  });
}

async function statusEventKey(caseId: string, status: string): Promise<string> {
  const count = await prisma.supportCaseEvent.count({ where: { caseId, kind: "STATUS_CHANGED" } });
  return `support:status:${caseId}:${status}:${count + 1}`;
}

export async function caseView(row: {
  id: string; reference: string; category: string; status: string; priority: string;
  description: string; linkType: string; linkedReference: string | null;
  linkedSummary: string | null; authoritativeStatus: string | null; assignedTo: string | null;
  unreadCount: number; nextAction: string | null; createdAt: Date; updatedAt: Date;
  lastActivityAt: Date; resolvedAt: Date | null;
}): Promise<SupportCaseView> {
  return {
    id: row.id,
    reference: row.reference,
    category: row.category as SupportCategory,
    status: row.status as SupportCaseStatus,
    priority: row.priority as SupportPriority,
    description: row.description,
    linkType: row.linkType as SupportLinkType,
    linkedReference: row.linkedReference,
    linkedSummary: row.linkedSummary,
    authoritativeStatus: row.authoritativeStatus,
    assignedTo: row.assignedTo,
    unreadCount: row.unreadCount,
    nextAction: row.nextAction,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    notice: SUPPORT_NOTICE,
  };
}

async function owned(userId: string, id: string) {
  const row = await prisma.supportCase.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Case not found");
  return row;
}

async function staffCase(id: string) {
  const row = await prisma.supportCase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Case not found");
  return row;
}

export async function createCase(userId: string, input: {
  category: SupportCategory;
  linkedType: SupportLinkType;
  linkedReference?: string;
  description: string;
  guidedAnswers?: Record<string, string>;
  idempotencyKey: string;
}): Promise<SupportCaseView> {
  const existing = await prisma.supportCase.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.userId !== userId) throw new ApiError(404, "VALIDATION_ERROR", "Case not found");
    return caseView(existing);
  }
  // Retry with a different key must not create a second case for the same issue.
  const recent = await prisma.supportCase.findFirst({
    where: {
      userId,
      category: input.category,
      linkedReference: input.linkedReference ?? null,
      description: input.description,
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
  });
  if (recent) return caseView(recent);

  let link: Awaited<ReturnType<typeof resolveLink>> | null = null;
  if (input.linkedType !== "GENERAL" && input.linkedReference) {
    const expected = categoryOption(input.category).linkType;
    if (expected !== input.linkedType) {
      throw new ApiError(400, "VALIDATION_ERROR", "The selected record type does not match this issue category");
    }
    link = await resolveLink(userId, input.linkedType, input.linkedReference);
  }

  const priority = initialPriority(input.category, input.description);
  const row = await prisma.supportCase.create({
    data: {
      reference: makeReference(),
      userId,
      category: input.category,
      status: "OPEN",
      priority,
      description: input.description,
      guidedAnswers: (input.guidedAnswers ?? {}) as object,
      linkType: input.linkedType,
      linkedReference: link?.linkedReference ?? input.linkedReference ?? null,
      linkedSummary: link?.linkedSummary ?? null,
      authoritativeStatus: link?.authoritativeStatus ?? null,
      idempotencyKey: input.idempotencyKey,
      nextAction: null,
    },
  });

  if (link && link.linkedReference) {
    await prisma.supportLinkedOperation.create({
      data: {
        caseId: row.id,
        module: input.linkedType,
        operationRef: link.linkedReference,
        ownerVerified: true,
        authoritativeStatus: link.authoritativeStatus,
        providerReference: link.providerReference,
        lastSyncedAt: new Date(),
      },
    });
  }

  await appendEvent({
    caseId: row.id, kind: "CASE_CREATED",
    detail: `Case ${row.reference} created via ${CUSTOMER_RAISED}.`,
    actorType: CUSTOMER_RAISED, actorId: userId, actorLabel: "Customer",
  });
  if (priority !== "NORMAL") {
    await prisma.supportPriorityHistory.create({
      data: { caseId: row.id, priority, reason: "Documented category/description rule", changedBy: "SYSTEM" },
    });
  }
  await notifySupport({
    userId, eventKey: `support:created:${row.id}`, type: "SUPPORT_CASE_CREATED",
    title: `Support case ${row.reference} created`,
    body: SUPPORT_NOTICE, caseId: row.id, preference: "caseUpdates",
    data: { caseId: row.id, reference: row.reference },
  });
  await recordSupportAudit({
    actorType: CUSTOMER_RAISED, actorId: userId, action: "SUPPORT_CASE_CREATED",
    targetType: "SUPPORT_CASE", targetId: row.id,
    metadata: { category: input.category, linkType: input.linkedType, verifiedLink: Boolean(link) },
  });
  if (input.category === "UNAUTHORIZED_ACTIVITY") {
    await publishSupportSecurity({
      type: "SUPPORT_CASE_CREATED", actorId: userId, subjectId: userId,
      metadata: { caseId: row.id, reference: row.reference, signal: "UNAUTHORIZED_ACTIVITY" },
    });
  }
  return caseView(row);
}

export async function listCases(
  userId: string,
  filters: { status?: string; category?: string; limit?: number; offset?: number } = {},
): Promise<SupportCaseView[]> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const rows = await prisma.supportCase.findMany({
    where: {
      userId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    },
    orderBy: { lastActivityAt: "desc" },
    take: limit,
    skip: offset,
  });
  return Promise.all(rows.map(caseView));
}

export async function getCase(userId: string, id: string): Promise<SupportCaseDetailView> {
  const row = await owned(userId, id);
  const [events, messages] = await Promise.all([
    prisma.supportCaseEvent.findMany({
      where: { caseId: id, customerVisible: true }, orderBy: { createdAt: "asc" }, take: 200,
    }),
    prisma.supportMessage.findMany({
      where: { caseId: id, visibility: "CUSTOMER_VISIBLE" },
      orderBy: { createdAt: "asc" }, take: 200,
      include: { attachments: { where: { removedAt: null, visibility: "CUSTOMER_VISIBLE" } } },
    }),
  ]);
  await prisma.supportMessageReadState.upsert({
    where: { caseId_userId: { caseId: id, userId } },
    create: { caseId: id, userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  if (row.unreadCount > 0) await prisma.supportCase.update({ where: { id }, data: { unreadCount: 0 } });
  const resolution = await prisma.supportResolution.findFirst({ where: { caseId: id }, orderBy: { proposedAt: "desc" } });
  return {
    ...(await caseView(row)),
    unreadCount: 0,
    events: events.map((event) => ({
      id: event.id, kind: event.kind, detail: event.detail,
      createdAt: event.createdAt.toISOString(), actorLabel: event.actorLabel,
    })),
    messages: messages.map((message) => ({
      id: message.id,
      senderLabel: message.senderLabel,
      senderRole: message.senderRole,
      body: message.body,
      visibility: "CUSTOMER_VISIBLE" as const,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id, fileName: attachment.fileName, contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes, uploadedAt: attachment.uploadedAt.toISOString(),
      })),
    })),
    resolutionSummary: resolution?.summary ?? null,
  };
}

export async function sendMessage(userId: string, caseId: string, input: {
  body: string; idempotencyKey?: string;
}) {
  const row = await owned(userId, caseId);
  if (row.status === "CLOSED") throw new ApiError(409, "VALIDATION_ERROR", "Case is closed");
  if (input.idempotencyKey) {
    const existing = await prisma.supportMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing.id;
  }
  const message = await prisma.supportMessage.create({
    data: {
      caseId,
      senderType: CUSTOMER_RAISED, senderId: userId, senderLabel: "Customer",
      senderRole: "CUSTOMER", body: input.body, visibility: "CUSTOMER_VISIBLE",
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  const flagged = isSensitiveText(input.body);
  await appendEvent({
    caseId, kind: flagged ? "SENSITIVE_CONTENT_FLAGGED" : "USER_RESPONDED",
    detail: flagged
      ? "A message was flagged for sensitive-content handling. Content is not repeated in the timeline."
      : "Customer sent a message.",
    actorType: CUSTOMER_RAISED, actorId: userId, actorLabel: "Customer",
  });
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { lastActivityAt: new Date(), ...(row.status === "WAITING_FOR_USER" ? { status: "IN_PROGRESS" } : {}) },
  });
  await recordSupportAudit({ actorType: CUSTOMER_RAISED, actorId: userId, action: "SUPPORT_MESSAGE_SENT", targetType: "SUPPORT_CASE", targetId: caseId });
  if (flagged) {
    await supportSecurityAudit({
      actorType: CUSTOMER_RAISED, actorId: userId, action: "SUPPORT_SENSITIVE_CONTENT_FLAGGED",
      targetType: "SUPPORT_MESSAGE", targetId: message.id,
      justification: "Potential credentials submitted in a support message; handle without redistribution.",
    });
  }
  return message.id;
}

export async function addInternalNote(actorId: string, caseId: string, input: {
  body: string; idempotencyKey?: string;
}) {
  await staffCase(caseId);
  if (input.idempotencyKey) {
    const existing = await prisma.supportMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing.id;
  }
  const message = await prisma.supportMessage.create({
    data: {
      caseId,
      senderType: STAFF_RAISED, senderId: actorId, senderLabel: "Support staff",
      senderRole: "STAFF", body: input.body, visibility: "INTERNAL_ONLY",
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  await appendEvent({
    caseId, kind: "INTERNAL_NOTE_ADDED",
    detail: "An internal note was added. Its content is not customer-visible.",
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff", customerVisible: false,
  });
  await prisma.supportCase.update({ where: { id: caseId }, data: { lastActivityAt: new Date() } });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_INTERNAL_NOTE_ADDED", targetType: "SUPPORT_CASE", targetId: caseId });
  await supportSecurityAudit({
    actorType: STAFF_RAISED, actorId, action: "SUPPORT_INTERNAL_NOTE_ACCESSED",
    targetType: "SUPPORT_MESSAGE", targetId: message.id,
    justification: "Internal support note created.",
  });
  return message.id;
}

export async function sendStaffMessage(actorId: string, caseId: string, input: {
  body: string; idempotencyKey?: string;
}) {
  const row = await staffCase(caseId);
  if (input.idempotencyKey) {
    const existing = await prisma.supportMessage.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing.id;
  }
  const message = await prisma.supportMessage.create({
    data: {
      caseId,
      senderType: STAFF_RAISED, senderId: actorId, senderLabel: "Nexus Pay Support",
      senderRole: "SUPPORT_AGENT", body: input.body, visibility: "CUSTOMER_VISIBLE",
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });
  await appendEvent({
    caseId, kind: "SUPPORT_REPLIED", detail: "Support replied.",
    actorType: STAFF_RAISED, actorId, actorLabel: "Nexus Pay Support",
  });
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { lastActivityAt: new Date(), unreadCount: { increment: 1 }, status: "WAITING_FOR_USER", nextAction: defaultNextAction("WAITING_FOR_USER") },
  });
  await notifySupport({
    userId: row.userId, eventKey: `support:reply:${caseId}:${message.id}`,
    type: "SUPPORT_MESSAGE_RECEIVED", title: `New message on case ${row.reference}`,
    body: SUPPORT_NOTICE, caseId, preference: "messages",
    data: { caseId, reference: row.reference },
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_REPLY_SENT", targetType: "SUPPORT_CASE", targetId: caseId });
  return message.id;
}

export async function transitionStatus(actorId: string, caseId: string, input: {
  status: SupportCaseStatus; note?: string;
}) {
  const row = await staffCase(caseId);
  if (!CASE_TRANSITIONS[row.status as SupportCaseStatus]?.includes(input.status)) {
    throw new ApiError(409, "VALIDATION_ERROR", `Cannot change status from ${row.status} to ${input.status}`);
  }
  const waitingForUser = input.status === "WAITING_FOR_USER";
  await prisma.supportCase.update({
    where: { id: caseId },
    data: {
      status: input.status,
      nextAction: defaultNextAction(input.status),
      lastActivityAt: new Date(),
      ...(input.status === "RESOLVED" ? { resolvedAt: new Date() } : {}),
      ...(input.status === "CLOSED" ? { closedAt: new Date() } : {}),
      ...(input.status === "REOPENED" ? { resolvedAt: null, closedAt: null } : {}),
    },
  });
  await appendEvent({
    caseId,
    kind: waitingForUser ? "INFO_REQUESTED" : "STATUS_CHANGED",
    detail: input.note ? `Status ${row.status} → ${input.status}. ${input.note}` : `Status ${row.status} → ${input.status}.`,
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff",
  });
  const type = waitingForUser ? "SUPPORT_INFO_REQUESTED"
    : input.status === "RESOLVED" ? "SUPPORT_CASE_RESOLVED"
    : input.status === "REOPENED" ? "SUPPORT_CASE_REOPENED"
    : "SUPPORT_CASE_STATUS_CHANGED";
  await notifySupport({
    userId: row.userId, eventKey: await statusEventKey(caseId, input.status), type,
    title: `Case ${row.reference}: ${input.status.replaceAll("_", " ").toLowerCase()}`,
    body: SUPPORT_NOTICE, caseId, preference: "caseUpdates",
    data: { caseId, status: input.status },
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_STATUS_CHANGED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { from: row.status, to: input.status } });
  return caseView(await staffCase(caseId));
}

export async function setPriority(actorId: string, caseId: string, input: {
  priority: SupportPriority; reason: string;
}) {
  const row = await staffCase(caseId);
  await prisma.supportPriorityHistory.create({
    data: { caseId, priority: input.priority, reason: input.reason, changedBy: actorId },
  });
  await prisma.supportCase.update({ where: { id: caseId }, data: { priority: input.priority, lastActivityAt: new Date() } });
  await appendEvent({
    caseId, kind: "PRIORITY_CHANGED",
    detail: `Priority ${row.priority} → ${input.priority}. Reason: ${input.reason}`,
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff", customerVisible: false,
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_PRIORITY_CHANGED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { from: row.priority, to: input.priority } });
  return caseView(await staffCase(caseId));
}

export async function assignCase(actorId: string, caseId: string, assigneeId: string | null) {
  await staffCase(caseId);
  if (assigneeId) {
    await prisma.supportCaseAssignment.updateMany({
      where: { caseId, unassignedAt: null }, data: { unassignedAt: new Date() },
    });
    await prisma.supportCaseAssignment.create({
      data: { caseId, assigneeId, assignedBy: actorId },
    });
  }
  await prisma.supportCase.update({ where: { id: caseId }, data: { assignedTo: assigneeId, lastActivityAt: new Date() } });
  await appendEvent({
    caseId, kind: "CASE_ASSIGNED",
    detail: assigneeId ? `Case assigned to ${assigneeId}.` : "Case unassigned.",
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff",
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_CASE_ASSIGNED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { assigneeId } });
  return caseView(await staffCase(caseId));
}

export async function escalateCase(actorId: string, caseId: string, input: {
  reason: string; signal: string;
}) {
  await staffCase(caseId);
  if (!ESCALATION_SIGNALS.has(input.signal)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Unknown escalation signal");
  }
  await prisma.supportEscalation.create({
    data: { caseId, reason: input.reason, signal: input.signal, escalatedBy: actorId },
  });
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { status: "ESCALATED", priority: "HIGH", nextAction: defaultNextAction("ESCALATED"), lastActivityAt: new Date() },
  });
  await prisma.supportPriorityHistory.create({
    data: { caseId, priority: "HIGH", reason: `Escalation: ${input.signal}`, changedBy: actorId },
  });
  await appendEvent({
    caseId, kind: "CASE_ESCALATED",
    detail: `Escalated (${input.signal}): ${input.reason}`,
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff", customerVisible: false,
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_CASE_ESCALATED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { signal: input.signal } });
  await publishSupportSecurity({ type: "SUPPORT_CASE_ESCALATED", actorId, metadata: { caseId, signal: input.signal } });
  return caseView(await staffCase(caseId));
}

export async function proposeResolution(actorId: string, caseId: string, input: {
  summary: string; outcome: "RESOLVED" | "NO_ACTION_REQUIRED" | "REFERRED_TO_PROVIDER_WORKFLOW";
  providerReference?: string;
}) {
  const row = await staffCase(caseId);
  await prisma.supportResolution.create({
    data: {
      caseId, summary: input.summary, outcome: input.outcome,
      providerReference: input.providerReference ?? null, proposedBy: actorId,
    },
  });
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { status: "RESOLUTION_PROPOSED", resolutionSummary: input.summary, nextAction: defaultNextAction("RESOLUTION_PROPOSED"), lastActivityAt: new Date() },
  });
  await appendEvent({
    caseId, kind: "RESOLUTION_PROPOSED", detail: "A resolution was proposed for customer review.",
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff",
  });
  await notifySupport({
    userId: row.userId, eventKey: await statusEventKey(caseId, "RESOLUTION_PROPOSED"),
    type: "SUPPORT_RESOLUTION_PROPOSED", title: `Resolution proposed for case ${row.reference}`,
    body: SUPPORT_NOTICE, caseId, preference: "resolutionNotices", data: { caseId },
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_RESOLUTION_PROPOSED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { outcome: input.outcome } });
  return caseView(await staffCase(caseId));
}

export async function resolveCase(actorId: string, caseId: string, input: {
  summary: string; outcome: "RESOLVED" | "NO_ACTION_REQUIRED" | "REFERRED_TO_PROVIDER_WORKFLOW";
  providerReference?: string;
}) {
  const row = await staffCase(caseId);
  if (row.status !== "RESOLUTION_PROPOSED" && row.status !== "ESCALATED" && row.status !== "IN_PROGRESS") {
    throw new ApiError(409, "VALIDATION_ERROR", "Case must be in progress, escalated or resolution-proposed before resolving");
  }
  await prisma.supportResolution.create({
    data: {
      caseId, summary: input.summary, outcome: input.outcome,
      providerReference: input.providerReference ?? null,
      proposedBy: actorId, resolvedBy: actorId, resolvedAt: new Date(),
    },
  });
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { status: "RESOLVED", resolutionSummary: input.summary, resolvedAt: new Date(), nextAction: null, lastActivityAt: new Date() },
  });
  await appendEvent({
    caseId, kind: "CASE_RESOLVED", detail: "Case resolved. Support status does not change any financial status.",
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff",
  });
  await notifySupport({
    userId: row.userId, eventKey: await statusEventKey(caseId, "RESOLVED"),
    type: "SUPPORT_CASE_RESOLVED", title: `Case ${row.reference} resolved`,
    body: SUPPORT_NOTICE, caseId, preference: "resolutionNotices", data: { caseId },
  });
  await recordSupportAudit({ actorType: STAFF_RAISED, actorId, action: "SUPPORT_CASE_RESOLVED", targetType: "SUPPORT_CASE", targetId: caseId, metadata: { outcome: input.outcome } });
  return caseView(await staffCase(caseId));
}

export async function reopenCase(userId: string, caseId: string) {
  const row = await owned(userId, caseId);
  if (!["RESOLVED", "CLOSED"].includes(row.status)) {
    throw new ApiError(409, "VALIDATION_ERROR", "Only resolved or closed cases can be reopened");
  }
  await prisma.supportCase.update({
    where: { id: caseId },
    data: { status: "REOPENED", resolvedAt: null, closedAt: null, lastActivityAt: new Date(), nextAction: null },
  });
  await appendEvent({
    caseId, kind: "CASE_REOPENED", detail: "Customer reopened the case.",
    actorType: CUSTOMER_RAISED, actorId: userId, actorLabel: "Customer",
  });
  await notifySupport({
    userId, eventKey: await statusEventKey(caseId, "REOPENED"), type: "SUPPORT_CASE_REOPENED",
    title: `Case ${row.reference} reopened`, body: SUPPORT_NOTICE, caseId,
    preference: "caseUpdates", data: { caseId },
  });
  await recordSupportAudit({ actorType: CUSTOMER_RAISED, actorId: userId, action: "SUPPORT_CASE_REOPENED", targetType: "SUPPORT_CASE", targetId: caseId });
  return caseView(await staffCase(caseId));
}

/** Read-only refresh of a linked operation's authoritative status. */
export async function refreshLinkedOperation(actorId: string, caseId: string) {
  await staffCase(caseId);
  const links = await prisma.supportLinkedOperation.findMany({ where: { caseId } });
  let refreshed = 0;
  for (const link of links) {
    const status = await refreshAuthoritativeStatus({
      userId: (await staffCase(caseId)).userId,
      type: link.module as SupportLinkType,
      reference: link.operationRef,
    });
    if (status !== link.authoritativeStatus) {
      await prisma.supportLinkedOperation.update({
        where: { id: link.id },
        data: { authoritativeStatus: status, lastSyncedAt: new Date() },
      });
      await appendEvent({
        caseId, kind: "PROVIDER_STATUS_RECEIVED",
        detail: `Authoritative status for a linked ${link.module.toLowerCase()} changed. Support status is unchanged.`,
        actorType: "SYSTEM", actorId: "support-worker", actorLabel: "Support worker",
      });
      refreshed += 1;
    }
  }
  return refreshed;
}

export async function recordProviderInquiry(actorId: string, caseId: string, input: {
  module: string; operationRef: string; status?: string;
}) {
  await staffCase(caseId);
  const existing = await prisma.supportProviderInquiry.findUnique({
    where: { caseId_module_operationRef: { caseId, module: input.module, operationRef: input.operationRef } },
  });
  if (existing) return existing.id; // duplicate inquiry prevention
  const row = await prisma.supportProviderInquiry.create({
    data: {
      caseId, module: input.module, operationRef: input.operationRef,
      status: input.status ?? "PENDING", requestedBy: actorId, lastSyncedAt: new Date(),
    },
  });
  await appendEvent({
    caseId, kind: "PROVIDER_INQUIRY_INITIATED",
    detail: `Provider inquiry opened for a linked ${input.module.toLowerCase()}.`,
    actorType: STAFF_RAISED, actorId, actorLabel: "Support staff", customerVisible: false,
  });
  return row.id;
}

export async function listStaffCases(filters: {
  status?: string; priority?: string; category?: string; assignedTo?: string; limit?: number; offset?: number;
} = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const rows = await prisma.supportCase.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
    },
    orderBy: { lastActivityAt: "desc" },
    take: limit,
    skip: offset,
  });
  return Promise.all(rows.map(caseView));
}
