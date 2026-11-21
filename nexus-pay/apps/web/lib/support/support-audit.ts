/** Release 19 — shared audit, notification dedupe and security-event helpers. */
import { prisma } from "@nexus/database";
import type { NotificationType } from "@prisma/client";
import { createNotification } from "@/lib/social/shared";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

export async function recordSupportAudit(input: {
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.supportAuditEvent.create({
    data: {
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}

type SupportNotificationPreferenceField = "caseUpdates" | "messages" | "resolutionNotices";

/**
 * Idempotent notification. `eventKey` is stable so a retried worker or request
 * can never notify twice. No financial outcome is implied by the notification.
 */
export async function notifySupport(input: {
  userId: string;
  eventKey: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  caseId?: string | null;
  preference?: SupportNotificationPreferenceField;
  data?: Record<string, string | number | boolean | null>;
}) {
  const existing = await prisma.supportNotificationEvent.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) return false;
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } });
  if (!user) return false;
  if (input.preference) {
    const pref = await prisma.supportNotificationPreference.findUnique({ where: { userId: input.userId } });
    if (pref && !pref[input.preference]) return false;
  }
  await prisma.supportNotificationEvent.create({
    data: {
      eventKey: input.eventKey,
      userId: input.userId,
      caseId: input.caseId ?? null,
      type: input.type,
    },
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

export async function publishSupportSecurity(input: {
  type: string;
  actorId?: string;
  subjectId?: string;
  transactionRef?: string;
  metadata?: Record<string, unknown>;
}) {
  await publishSecurityEvent({
    type: input.type,
    actorId: input.actorId,
    subjectId: input.subjectId,
    transactionRef: input.transactionRef,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    sourceModule: "support-centre",
  });
}

export async function supportSecurityAudit(input: {
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  justification?: string;
  metadata?: Record<string, unknown>;
}) {
  await securityAudit({
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    justification: input.justification,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
  });
}
