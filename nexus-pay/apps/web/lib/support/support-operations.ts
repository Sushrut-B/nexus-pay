/** Release 19 — Nexus Control support workspace and fact-based analytics. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type { SupportOperationsView } from "@nexus/shared-types";
import { SUPPORT_NOTICE } from "@/lib/support/support-constants";
import { caseView } from "@/lib/support/case-service";

export async function getSupportPreferences(userId: string) {
  const row = await prisma.supportNotificationPreference.findUnique({ where: { userId } });
  return {
    caseUpdates: row?.caseUpdates ?? true,
    messages: row?.messages ?? true,
    resolutionNotices: row?.resolutionNotices ?? true,
  };
}

export async function updateSupportPreferences(userId: string, input: {
  caseUpdates?: boolean; messages?: boolean; resolutionNotices?: boolean;
}) {
  const row = await prisma.supportNotificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      caseUpdates: input.caseUpdates ?? true,
      messages: input.messages ?? true,
      resolutionNotices: input.resolutionNotices ?? true,
    },
    update: {
      ...(input.caseUpdates !== undefined ? { caseUpdates: input.caseUpdates } : {}),
      ...(input.messages !== undefined ? { messages: input.messages } : {}),
      ...(input.resolutionNotices !== undefined ? { resolutionNotices: input.resolutionNotices } : {}),
    },
  });
  return { caseUpdates: row.caseUpdates, messages: row.messages, resolutionNotices: row.resolutionNotices };
}

export async function getStaffCaseDetail(caseId: string) {
  const row = await prisma.supportCase.findUnique({ where: { id: caseId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Case not found");
  const [messages, events, links, inquiries, resolutions, priorities, escalations] = await Promise.all([
    prisma.supportMessage.findMany({ where: { caseId }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.supportCaseEvent.findMany({ where: { caseId }, orderBy: { createdAt: "asc" }, take: 200 }),
    prisma.supportLinkedOperation.findMany({ where: { caseId } }),
    prisma.supportProviderInquiry.findMany({ where: { caseId } }),
    prisma.supportResolution.findMany({ where: { caseId }, orderBy: { proposedAt: "desc" }, take: 10 }),
    prisma.supportPriorityHistory.findMany({ where: { caseId }, orderBy: { changedAt: "desc" }, take: 20 }),
    prisma.supportEscalation.findMany({ where: { caseId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return {
    ...(await caseView(row)),
    userId: row.userId,
    messages: messages.map((message) => ({
      id: message.id, body: message.body, visibility: message.visibility,
      senderLabel: message.senderLabel, senderRole: message.senderRole,
      createdAt: message.createdAt.toISOString(),
    })),
    events: events.map((event) => ({
      id: event.id, kind: event.kind, detail: event.detail,
      customerVisible: event.customerVisible, createdAt: event.createdAt.toISOString(),
    })),
    linkedOperations: links.map((link) => ({
      id: link.id, module: link.module, operationRef: link.operationRef,
      ownerVerified: link.ownerVerified, authoritativeStatus: link.authoritativeStatus,
      providerReference: link.providerReference, lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
    })),
    providerInquiries: inquiries.map((inquiry) => ({
      id: inquiry.id, module: inquiry.module, operationRef: inquiry.operationRef,
      status: inquiry.status, createdAt: inquiry.createdAt.toISOString(),
    })),
    resolutions: resolutions.map((resolution) => ({
      id: resolution.id, outcome: resolution.outcome, summary: resolution.summary,
      providerReference: resolution.providerReference,
      proposedAt: resolution.proposedAt.toISOString(), resolvedAt: resolution.resolvedAt?.toISOString() ?? null,
    })),
    priorityHistory: priorities.map((priority) => ({
      priority: priority.priority, reason: priority.reason, changedBy: priority.changedBy,
      changedAt: priority.changedAt.toISOString(),
    })),
    escalations: escalations.map((escalation) => ({
      reason: escalation.reason, signal: escalation.signal, escalatedBy: escalation.escalatedBy,
      createdAt: escalation.createdAt.toISOString(),
    })),
  };
}

function averageMinutes(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export async function getSupportOperations(filters: {
  status?: string; priority?: string; category?: string; assignedTo?: string;
  limit?: number; offset?: number;
} = {}): Promise<SupportOperationsView> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
  };
  const [rows, total, allCases, firstMessages, resolvedCases, reopenEvents, audit] = await Promise.all([
    prisma.supportCase.findMany({ where, orderBy: { lastActivityAt: "desc" }, take: limit, skip: offset }),
    prisma.supportCase.count({ where }),
    prisma.supportCase.findMany({ select: { status: true, category: true, linkType: true, createdAt: true } }),
    prisma.supportMessage.findMany({
      where: { visibility: "CUSTOMER_VISIBLE", senderRole: { not: "CUSTOMER" } },
      select: { caseId: true, createdAt: true },
    }),
    prisma.supportCase.findMany({
      where: { resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true },
    }),
    prisma.supportCaseEvent.count({ where: { kind: "CASE_REOPENED" } }),
    prisma.supportAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byModule: Record<string, number> = {};
  const backlogAging: Record<string, number> = { "0-2d": 0, "3-7d": 0, "8-30d": 0, "30d+": 0 };
  const now = Date.now();
  for (const row of allCases) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    byModule[row.linkType] = (byModule[row.linkType] ?? 0) + 1;
    const ageDays = Math.floor((now - row.createdAt.getTime()) / 86400000);
    if (ageDays <= 2) backlogAging["0-2d"] += 1;
    else if (ageDays <= 7) backlogAging["3-7d"] += 1;
    else if (ageDays <= 30) backlogAging["8-30d"] += 1;
    else backlogAging["30d+"] += 1;
  }

  const firstResponseTimes: number[] = [];
  const seen = new Set<string>();
  for (const message of firstMessages) {
    if (seen.has(message.caseId)) continue;
    seen.add(message.caseId);
    const supportCase = await prisma.supportCase.findUnique({ where: { id: message.caseId }, select: { createdAt: true } });
    if (supportCase) firstResponseTimes.push(Math.max(0, Math.round((message.createdAt.getTime() - supportCase.createdAt.getTime()) / 60000)));
  }

  const resolvedCount = resolvedCases.length;
  return {
    cases: await Promise.all(rows.map(caseView)),
    total,
    open: allCases.filter((row) => !["RESOLVED", "CLOSED"].includes(row.status)).length,
    awaitingUser: byStatus.WAITING_FOR_USER ?? 0,
    awaitingProvider: byStatus.WAITING_FOR_PROVIDER ?? 0,
    escalated: byStatus.ESCALATED ?? 0,
    resolutionProposed: byStatus.RESOLUTION_PROPOSED ?? 0,
    resolved: allCases.filter((row) => ["RESOLVED", "CLOSED"].includes(row.status)).length,
    reopenRateBps: resolvedCount ? Math.round((reopenEvents / resolvedCount) * 10000) : 0,
    firstResponseMinutes: averageMinutes(firstResponseTimes),
    resolutionMinutes: averageMinutes(
      resolvedCases.filter((row) => row.resolvedAt).map((row) => Math.max(0, Math.round((row.resolvedAt!.getTime() - row.createdAt.getTime()) / 60000))),
    ),
    byCategory, byModule, byStatus, backlogAging,
    audit: audit.map((event) => ({
      id: event.id, action: event.action, actorId: event.actorId,
      createdAt: event.createdAt.toISOString(),
    })),
    notice: `${SUPPORT_NOTICE} No service-level commitment is implied; metrics use actual case timestamps only.`,
  };
}
