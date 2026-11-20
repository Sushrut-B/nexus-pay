import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@nexus/database";
import { getServerEnv } from "@/lib/env";
import { securityAudit } from "@/lib/fraud/audit-service";

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 3;

/** Publishes claimed outbox rows into the immutable event store. Idempotent by eventId. */
export async function processOutboxRow(rowId: string): Promise<"published" | "skipped"> {
  const claimed = await prisma.securityEventOutbox.updateMany({
    where: { id: rowId, status: "PENDING" },
    data: { status: "PROCESSING", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (claimed.count === 0) return "skipped";
  const row = await prisma.securityEventOutbox.findUnique({ where: { id: rowId } });
  if (!row) return "skipped";
  try {
    const payload = row.payload as Record<string, unknown>;
    const retentionDays = getServerEnv().NEXUS_FRAUD_RETENTION_DAYS;
    await prisma.securityEvent.upsert({
      where: { eventId: row.eventId },
      create: {
        eventId: row.eventId,
        type: payload.type as never,
        version: Number(payload.version ?? 1),
        occurredAt: new Date(String(payload.occurredAt)),
        actorId: payload.actorId as string | null,
        subjectId: payload.subjectId as string | null,
        accountId: payload.accountId as string | null,
        sessionId: payload.sessionId as string | null,
        sourceModule: String(payload.sourceModule),
        correlationId: payload.correlationId as string | null,
        requestId: payload.requestId as string | null,
        deviceId: payload.deviceId as string | null,
        ipHash: payload.ipHash as string | null,
        transactionRef: payload.transactionRef as string | null,
        metadata: (payload.metadata ?? {}) as Prisma.InputJsonValue,
        retentionExpiresAt: new Date(Date.now() + retentionDays * 86_400_000),
      },
      update: {},
    });
    await prisma.securityEventOutbox.update({
      where: { id: rowId },
      data: { status: "PUBLISHED", publishedAt: new Date(), leaseUntil: null, error: null },
    });
    return "published";
  } catch (error) {
    const attempts = row.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    await prisma.securityEventOutbox.update({
      where: { id: rowId },
      data: {
        status: dead ? "DEAD_LETTER" : "PENDING",
        leaseUntil: null,
        error: error instanceof Error ? error.message.slice(0, 500) : "Publication failed",
        nextAttemptAt: dead ? null : new Date(Date.now() + 60_000 * attempts),
      },
    });
    if (dead) {
      await securityAudit({
        actorType: "SYSTEM", actorId: "security-event-worker", action: "SECURITY_EVENT_DEAD_LETTER",
        targetType: "security_event_outbox", targetId: rowId, metadata: { eventId: row.eventId },
      });
    }
    return "skipped";
  }
}

export async function runSecurityEventWorker(limit = 50): Promise<{ published: number }> {
  const rows = await prisma.securityEventOutbox.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let published = 0;
  for (const row of rows) {
    if ((await processOutboxRow(row.id)) === "published") published += 1;
  }
  return { published };
}

export function newCorrelationId(): string {
  return `cor_${randomUUID()}`;
}
