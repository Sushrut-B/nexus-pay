import type { Prisma } from "@prisma/client";
import { prisma } from "@nexus/database";

export interface SecurityAuditInput {
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  justification?: string;
  metadata?: Record<string, unknown>;
  outcome?: "SUCCESS" | "FAILURE" | "INFO";
}

/** Append-only audit log for every sensitive fraud/risk decision. */
export async function securityAudit(input: SecurityAuditInput): Promise<void> {
  try {
    await prisma.securityAuditEvent.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        justification: input.justification ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        outcome: input.outcome ?? "SUCCESS",
      },
    });
  } catch {
    // Auditing must never break a risk decision; monitoring detects gaps.
  }
}

export async function listSecurityAudit(limit = 100) {
  return prisma.securityAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
