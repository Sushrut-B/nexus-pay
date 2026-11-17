import { prisma } from "@nexus/database";
import type { AlertStatus, AlertView } from "@nexus/shared-types";
import { recordAdminAudit } from "@/lib/control/audit";

function toView(alert: {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  severity: AlertView["severity"];
  status: AlertStatus;
  nodeId: string | null;
  paymentRef: string | null;
  suggestedSteps: string | null;
  firstDetectedAt: Date;
  lastObservedAt: Date;
  resolvedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
}): AlertView {
  return {
    id: alert.id,
    fingerprint: alert.fingerprint,
    title: alert.title,
    description: alert.description,
    severity: alert.severity,
    status: alert.status,
    nodeId: alert.nodeId,
    paymentRef: alert.paymentRef,
    suggestedSteps: alert.suggestedSteps,
    firstDetectedAt: alert.firstDetectedAt.toISOString(),
    lastObservedAt: alert.lastObservedAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    acknowledgedBy: alert.acknowledgedBy,
    acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
  };
}

export async function listAlerts(status?: AlertStatus): Promise<AlertView[]> {
  const alerts = await prisma.operationalAlert.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { severity: "asc" }, { lastObservedAt: "desc" }],
    take: 100,
  });
  return alerts.map(toView);
}

export async function acknowledgeAlert(
  alertId: string,
  admin: { id: string; email: string; roleName: string },
  reason: string | undefined,
  requestId: string,
): Promise<AlertView> {
  const alert = await prisma.operationalAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new Error("That alert could not be found.");
  if (alert.status === "RESOLVED") throw new Error("Resolved alerts cannot be acknowledged.");

  const updated = await prisma.operationalAlert.update({
    where: { id: alertId },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedBy: admin.id,
      acknowledgedAt: new Date(),
      metadata: { ...((alert.metadata ?? {}) as object), acknowledgementReason: reason ?? null },
    },
  });
  await recordAdminAudit({
    actorId: admin.id,
    actorEmail: admin.email,
    actorRole: admin.roleName,
    action: "ALERT_ACKNOWLEDGED",
    targetType: "alert",
    targetId: alertId,
    reason,
    requestId,
    outcome: "SUCCESS",
  });
  return toView(updated);
}

export async function listAudit(limit = 100) {
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return logs.map((log) => ({
    id: log.id,
    actorId: log.actorId,
    actorEmail: log.actorEmail,
    actorRole: log.actorRole,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    reason: log.reason,
    requestId: log.requestId,
    ipAddress: log.ipAddress,
    outcome: log.outcome,
    metadata: (log.metadata ?? {}) as Record<string, unknown>,
    createdAt: log.createdAt.toISOString(),
  }));
}
