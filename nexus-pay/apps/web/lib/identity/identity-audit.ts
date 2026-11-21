/** Release 20 — security-event, notification dedupe and admin-action helpers. */
import { prisma } from "@nexus/database";
import type { NotificationType } from "@prisma/client";
import { createNotification } from "@/lib/social/shared";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

export async function publishIdentityEvent(input: {
  type: string;
  userId?: string | null;
  sessionId?: string | null;
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return publishSecurityEvent({
    type: input.type,
    actorId: input.actorId ?? input.userId ?? null,
    subjectId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    sourceModule: "account-security",
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    metadata: input.metadata,
  });
}

export async function identitySecurityAudit(input: {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  justification?: string;
  metadata?: Record<string, unknown>;
  outcome?: "SUCCESS" | "FAILURE" | "INFO";
}) {
  await securityAudit({
    actorType: "USER",
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    justification: input.justification,
    metadata: input.metadata,
    outcome: input.outcome ?? "SUCCESS",
  });
}

/** Idempotent security notification. Secrets are never accepted in body/data. */
export async function notifyIdentity(input: {
  userId: string;
  eventKey: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, string | number | boolean | null>;
}) {
  const existing = await prisma.securityNotificationEvent.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) return false;
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) return false;
  await prisma.securityNotificationEvent.create({
    data: { eventKey: input.eventKey, userId: input.userId, type: input.type },
  });
  await createNotification(prisma, {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    data: input.data,
  });
  return true;
}

export async function recordAdminSecurityAction(input: {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.adminSecurityAction.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      outcome: input.outcome ?? "SUCCESS",
      metadata: (input.metadata ?? {}) as object,
    },
  });
}
