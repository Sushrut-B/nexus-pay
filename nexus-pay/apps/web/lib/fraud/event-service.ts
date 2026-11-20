import { createHash, createHmac, randomUUID } from "node:crypto";
import type { Prisma, SecurityEvent as SecurityEventRow } from "@prisma/client";
import { prisma } from "@nexus/database";
import type { SecurityEventView } from "@nexus/shared-types";
import { getServerEnv } from "@/lib/env";
import { sanitizeMetadata } from "@/lib/fraud/config";

export type FraudDb = typeof prisma | Prisma.TransactionClient;

/** Privacy-preserving IP representation. Raw IP is never stored in security events. */
export function hashIp(ip?: string | null): string | null {
  if (!ip) return null;
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(ip).digest("hex").slice(0, 32);
}

export function hashDevice(userAgent?: string | null): string | null {
  if (!userAgent) return null;
  return createHash("sha256").update(userAgent).digest("hex").slice(0, 32);
}

export function eventView(row: SecurityEventRow): SecurityEventView {
  const metadata = sanitizeMetadata(row.metadata);
  return {
    id: row.id,
    eventId: row.eventId,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actorId: row.actorId,
    subjectId: row.subjectId,
    sourceModule: row.sourceModule,
    correlationId: row.correlationId,
    deviceId: row.deviceId,
    transactionRef: row.transactionRef,
    metadata,
    masked: true,
  };
}

export interface PublishInput {
  eventId?: string;
  type: string;
  occurredAt?: Date;
  actorId?: string | null;
  subjectId?: string | null;
  accountId?: string | null;
  sessionId?: string | null;
  sourceModule: string;
  correlationId?: string | null;
  requestId?: string | null;
  deviceId?: string | null;
  transactionRef?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  retentionDays?: number;
}

/**
 * Writes a durable outbox row. Callers may pass a transaction client so the
 * event and the domain change commit atomically (transactional outbox).
 */
export async function publishSecurityEvent(input: PublishInput, db: FraudDb = prisma, requestId?: string) {
  const eventId = input.eventId || `evt_${randomUUID()}`;
  const payload = {
    eventId,
    type: input.type,
    version: 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    actorId: input.actorId ?? null,
    subjectId: input.subjectId ?? null,
    accountId: input.accountId ?? null,
    sessionId: input.sessionId ?? null,
    sourceModule: input.sourceModule,
    correlationId: input.correlationId ?? null,
    requestId: input.requestId ?? requestId ?? null,
    deviceId: input.deviceId ?? null,
    ipHash: hashIp(input.ipAddress),
    userAgentHash: hashDevice(input.userAgent),
    transactionRef: input.transactionRef ?? null,
    metadata: sanitizeMetadata(input.metadata),
  } as const;
  await db.securityEventOutbox.upsert({
    where: { eventId },
    create: {
      eventId,
      type: payload.type as never,
      aggregateType: payload.sourceModule,
      aggregateId: payload.subjectId ?? payload.actorId ?? eventId,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
    update: {},
  });
  return eventId;
}

export async function listSecurityEvents(query: {
  page: number; pageSize: number; type?: string; actorId?: string; subjectId?: string; from?: string; to?: string;
}) {
  const where: Prisma.SecurityEventWhereInput = {
    ...(query.type ? { type: query.type as never } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    ...(query.from || query.to ? {
      occurredAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.securityEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.securityEvent.count({ where }),
  ]);
  return { items: rows.map(eventView), total };
}

export async function getSecurityEvent(id: string): Promise<SecurityEventView | null> {
  const row = await prisma.securityEvent.findFirst({ where: { OR: [{ id }, { eventId: id }] } });
  return row ? eventView(row) : null;
}

/** Counts recent events by type for rule evaluation. Returns 0 when engine has no history. */
export async function countRecentEvents(input: {
  type: string; actorId?: string; subjectId?: string; since: Date;
}): Promise<number> {
  return prisma.securityEvent.count({
    where: {
      type: input.type as never,
      occurredAt: { gte: input.since },
      ...(input.actorId ? { actorId: input.actorId } : {}),
      ...(input.subjectId ? { subjectId: input.subjectId } : {}),
    },
  });
}
