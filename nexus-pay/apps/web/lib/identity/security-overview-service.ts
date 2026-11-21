/** Release 20 — customer security overview and Nexus Control security operations. */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type { IdentitySecurityOverviewView, IdentitySecurityOperationsView } from "@nexus/shared-types";
import { listAuthMethods } from "@/lib/identity/mfa-service";
import { RETENTION_NOTICE } from "@/lib/identity/privacy-service";
import {
  notifyIdentity, publishIdentityEvent, recordAdminSecurityAction,
} from "@/lib/identity/identity-audit";

export async function getSecurityOverview(userId: string): Promise<IdentitySecurityOverviewView> {
  const [user, activeSessions, trustedDevices, methods, events, notifications] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { lastLoginAt: true } }),
    prisma.userSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
    prisma.trustedDevice.count({
      where: { userId, trusted: true, revokedAt: null },
    }),
    listAuthMethods(userId),
    prisma.securityEvent.findMany({
      where: { OR: [{ actorId: userId }, { subjectId: userId }] },
      orderBy: { occurredAt: "desc" }, take: 10,
      select: { id: true, type: true, occurredAt: true, sourceModule: true },
    }),
    prisma.notification.findMany({
      where: { userId, readAt: null }, select: { type: true }, take: 500,
    }),
  ]);
  return {
    lastLoginAt: user?.lastLoginAt?.toISOString() ?? null,
    activeSessions,
    trustedDevices,
    authMethods: methods,
    recentEvents: events.map((event) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt.toISOString(),
      sourceModule: event.sourceModule,
    })),
    unreadSecurityNotifications: notifications.filter((item) => String(item.type).startsWith("SECURITY_")).length,
    notices: [
      "Status indicators reflect recorded events only; no security score is calculated.",
      "Device and location information is approximate and request-derived.",
      "Recovery and MFA are not identity verification (KYC).",
      RETENTION_NOTICE,
    ],
  };
}

export async function getSecurityOperations(filters: {
  type?: string; actorId?: string; subjectId?: string; from?: Date; to?: Date;
  limit?: number; offset?: number;
} = {}): Promise<IdentitySecurityOperationsView> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = {
    ...(filters.type ? { type: filters.type as never } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.from || filters.to
      ? { occurredAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
  const [events, incidents, recoveryRequests, deletions, actions] = await Promise.all([
    prisma.securityEvent.findMany({
      where, orderBy: { occurredAt: "desc" }, take: limit, skip: offset,
      select: { id: true, type: true, actorId: true, subjectId: true, occurredAt: true, sourceModule: true },
    }),
    prisma.securityIncident.findMany({ orderBy: { openedAt: "desc" }, take: 50 }),
    prisma.accountRecoveryRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.dataDeletionRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.adminSecurityAction.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    events: events.map((event) => ({
      id: event.id, type: event.type, actorId: event.actorId, subjectId: event.subjectId,
      occurredAt: event.occurredAt.toISOString(), sourceModule: event.sourceModule,
    })),
    incidents: incidents.map((incident) => ({
      id: incident.id, subjectUserId: incident.subjectUserId, type: incident.type,
      status: incident.status, severity: incident.severity, summary: incident.summary,
      openedAt: incident.openedAt.toISOString(),
    })),
    recoveryRequests: recoveryRequests.map((request) => ({
      id: request.id, userId: request.userId, status: request.status,
      createdAt: request.createdAt.toISOString(),
    })),
    deletionRequests: deletions.map((deletion) => ({
      id: deletion.id, userId: deletion.userId, status: deletion.status,
      reason: deletion.reason, createdAt: deletion.createdAt.toISOString(),
    })),
    actions: actions.map((action) => ({
      id: action.id, actorId: action.actorId, action: action.action,
      targetType: action.targetType, targetId: action.targetId, reason: action.reason,
      outcome: action.outcome, createdAt: action.createdAt.toISOString(),
    })),
    notice: "Security operations are read-only except for explicitly audited session revocation, incident review and deletion-request review. No customer passwords, MFA secrets, recovery codes or session tokens are exposed.",
  };
}

export async function adminRevokeSession(actorId: string, sessionId: string, reason: string) {
  const session = await prisma.userSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new ApiError(404, "VALIDATION_ERROR", "Session not found");
  await prisma.userSession.update({
    where: { id: sessionId }, data: { revokedAt: new Date() },
  });
  await publishIdentityEvent({
    type: "SESSION_REVOKED", userId: session.userId, actorId,
    metadata: { reason, source: "ADMIN" },
  });
  await notifyIdentity({
    userId: session.userId,
    eventKey: `security:admin-revoke-session:${sessionId}:${Date.now()}`,
    type: "SECURITY_SESSION_REVOKED",
    title: "A session was signed out",
    body: "An administrator revoked one of your sessions. No account credentials were shared.",
  });
  await recordAdminSecurityAction({
    actorId, action: "ADMIN_SESSION_REVOKED", targetType: "USER_SESSION",
    targetId: sessionId, reason,
  });
  return { id: sessionId, revoked: true };
}

export async function adminRevokeAllSessions(actorId: string, userId: string, reason: string) {
  const result = await prisma.userSession.updateMany({
    where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
  });
  await publishIdentityEvent({
    type: "SESSION_REVOKED", userId, actorId, metadata: { reason, source: "ADMIN_ALL" },
  });
  await notifyIdentity({
    userId,
    eventKey: `security:admin-revoke-all:${userId}:${Date.now()}`,
    type: "SECURITY_SESSION_REVOKED",
    title: "All sessions were signed out",
    body: "An administrator signed out all of your sessions.",
  });
  await recordAdminSecurityAction({
    actorId, action: "ADMIN_SESSION_REVOKED", targetType: "USER", targetId: userId,
    reason, metadata: { count: result.count },
  });
  return { revoked: result.count };
}

export async function openSecurityIncident(input: {
  actorId: string; subjectUserId: string; type: string; summary: string;
  severity?: string;
}) {
  const row = await prisma.securityIncident.create({
    data: {
      subjectUserId: input.subjectUserId, type: input.type, summary: input.summary,
      severity: input.severity ?? "NORMAL", openedBy: input.actorId,
    },
  });
  await recordAdminSecurityAction({
    actorId: input.actorId, action: "SECURITY_INCIDENT_OPENED", targetType: "SECURITY_INCIDENT",
    targetId: row.id, reason: input.summary,
  });
  return row.id;
}

export async function resolveSecurityIncident(input: {
  actorId: string; incidentId: string; resolutionNote: string;
}) {
  const row = await prisma.securityIncident.findUnique({ where: { id: input.incidentId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Incident not found");
  await prisma.securityIncident.update({
    where: { id: row.id },
    data: { status: "RESOLVED", resolvedBy: input.actorId, resolvedAt: new Date(), resolutionNote: input.resolutionNote },
  });
  await recordAdminSecurityAction({
    actorId: input.actorId, action: "SECURITY_INCIDENT_RESOLVED", targetType: "SECURITY_INCIDENT",
    targetId: row.id, reason: input.resolutionNote,
  });
  return { id: row.id, status: "RESOLVED" };
}
