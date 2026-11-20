/** Release 18 — shared audit, notification and security-event helpers. */
import { prisma } from "@nexus/database";
import type { NotificationType } from "@prisma/client";
import { createNotification } from "@/lib/social/shared";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

export async function recordGlobalAudit(input: {
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.globalAuditEvent.create({
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

export async function notifyGlobal(
  userId: string,
  type: NotificationType,
  title: string,
  body?: string | null,
  data?: Record<string, string | number | boolean | null>,
) {
  // Deleted users (or test teardown) must not break a worker tick.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return;
  await createNotification(prisma, { userId, type, title, body: body ?? null, data });
}

export async function publishGlobalSecurity(input: {
  type: string;
  actorId?: string;
  subjectId?: string;
  transactionRef?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}) {
  await publishSecurityEvent({
    type: input.type,
    actorId: input.actorId,
    subjectId: input.subjectId,
    transactionRef: input.transactionRef,
    correlationId: input.correlationId,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    sourceModule: "global-finance",
  });
}
