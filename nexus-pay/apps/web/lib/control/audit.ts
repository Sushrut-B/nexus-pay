import { prisma, type Prisma } from "@nexus/database";
import type { AdminRole } from "@nexus/shared-types";

type Metadata = Prisma.InputJsonValue;

/**
 * Append-only administrative audit. There is no update or delete API for these
 * records; the admin UI only reads them.
 */
export async function recordAdminAudit(input: {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole: string | AdminRole;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  outcome: "SUCCESS" | "FAILURE" | "BLOCKED" | "INFO";
  metadata?: Metadata;
}): Promise<void> {
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorRole: input.actorRole,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason ?? null,
        requestId: input.requestId ?? null,
        ipAddress: input.ipAddress ?? null,
        outcome: input.outcome,
        metadata: input.metadata ?? {},
      },
    });
  } catch {
    // Audit must never break the primary operation.
  }
}
