/** Release 13 — privacy-preserving relationship analysis. Shared attributes are signals, never proof. */

import { prisma, type RelationshipKind } from "@nexus/database";
import { securityAudit } from "@/lib/fraud/audit-service";

export async function recordRelationship(input: {
  kind: RelationshipKind; fromKey: string; toKey: string; evidence?: Record<string, unknown>; actorId?: string;
}) {
  if (input.fromKey === input.toKey) return null;
  const row = await prisma.securityRelationship.upsert({
    where: { kind_fromKey_toKey: { kind: input.kind, fromKey: input.fromKey, toKey: input.toKey } },
    create: {
      kind: input.kind, fromKey: input.fromKey, toKey: input.toKey,
      strength: 1, evidence: (input.evidence ?? {}) as object,
    },
    update: { strength: { increment: 1 }, lastSeen: new Date() },
  });
  return row;
}

export async function listRelationships(kind?: RelationshipKind, key?: string, limit = 100) {
  return prisma.securityRelationship.findMany({
    where: {
      ...(kind ? { kind } : {}),
      ...(key ? { OR: [{ fromKey: key }, { toKey: key }] } : {}),
    },
    orderBy: { lastSeen: "desc" },
    take: limit,
  });
}

/** Counts distinct accounts attached to the same technical key for investigation only. */
export async function sharedKeyCount(kind: RelationshipKind, key: string): Promise<number> {
  const rows = await prisma.securityRelationship.findMany({ where: { kind } });
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.fromKey === key) keys.add(row.toKey);
    else if (row.toKey === key) keys.add(row.fromKey);
  }
  if (keys.size > 0) {
    await securityAudit({
      actorType: "SYSTEM", actorId: "relationship-analysis", action: "SHARED_KEY_ANALYSIS",
      targetType: "security_relationship", targetId: key,
      metadata: { kind, count: keys.size, note: "Signal only; not proof of fraud." },
    });
  }
  return keys.size;
}
