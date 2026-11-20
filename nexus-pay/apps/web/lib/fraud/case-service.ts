import { randomUUID } from "node:crypto";
import type { Prisma, FraudCaseStatus as FraudCaseStatusEnum, RiskAlertStatus } from "@nexus/database";
import { prisma } from "@nexus/database";
import type { FraudCaseStatus, RiskAlertView, FraudCaseView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { securityAudit } from "@/lib/fraud/audit-service";

const TRANSITIONS: Record<FraudCaseStatus, FraudCaseStatus[]> = {
  OPEN: ["TRIAGED", "INVESTIGATING", "CLOSED"],
  TRIAGED: ["INVESTIGATING", "CLOSED"],
  INVESTIGATING: ["CUSTOMER_CONTACT_REQUIRED", "PROVIDER_CONTACT_REQUIRED", "ESCALATED", "RESOLVED", "FALSE_POSITIVE", "CLOSED"],
  CUSTOMER_CONTACT_REQUIRED: ["INVESTIGATING", "ESCALATED", "RESOLVED", "FALSE_POSITIVE", "CLOSED"],
  PROVIDER_CONTACT_REQUIRED: ["INVESTIGATING", "ESCALATED", "RESOLVED", "FALSE_POSITIVE", "CLOSED"],
  ESCALATED: ["INVESTIGATING", "RESOLVED", "FALSE_POSITIVE", "CLOSED"],
  RESOLVED: [],
  FALSE_POSITIVE: [],
  CLOSED: [],
};

export function caseView(row: {
  id: string; caseNumber: string; userId: string | null; transactionRef: string | null;
  riskScore: number; status: string; priority: string; assignedTo: string | null;
  resolution: string | null; openedAt: Date; resolvedAt: Date | null;
}): FraudCaseView {
  return {
    id: row.id, caseNumber: row.caseNumber, userId: row.userId,
    transactionRef: row.transactionRef, riskScore: row.riskScore,
    status: row.status as FraudCaseStatus, priority: row.priority,
    assignedTo: row.assignedTo, resolution: row.resolution,
    openedAt: row.openedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export function alertView(row: {
  id: string; reference: string; score: number; severity: string; status: string;
  title: string; summary: string; triggeredRules: unknown; createdAt: Date;
}): RiskAlertView {
  return {
    id: row.id, reference: row.reference, score: row.score, severity: row.severity,
    status: row.status, title: row.title, summary: row.summary,
    triggeredRules: (row.triggeredRules as string[] | null) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAlerts(status?: string, limit = 100) {
  const rows = await prisma.riskAlert.findMany({
    where: status ? { status: status as RiskAlertStatus } : undefined,
    orderBy: { createdAt: "desc" }, take: limit,
  });
  return rows.map(alertView);
}

export async function getAlert(id: string) {
  const row = await prisma.riskAlert.findFirst({ where: { OR: [{ id }, { reference: id }] } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Risk alert not found.");
  const evaluation = row.evaluationId
    ? await prisma.riskEvaluation.findUnique({ where: { id: row.evaluationId } })
    : null;
  return { ...alertView(row), evaluationId: row.evaluationId, userId: row.userId, evaluation };
}

export async function acknowledgeAlert(id: string, actorId: string) {
  const row = await prisma.riskAlert.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Risk alert not found.");
  const updated = await prisma.riskAlert.update({
    where: { id },
    data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), assignedTo: actorId },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "RISK_ALERT_ACKNOWLEDGED",
    targetType: "risk_alert", targetId: id,
  });
  return alertView(updated);
}

/** Creates an investigation case from an alert. The case never claims confirmed fraud. */
export async function createCaseFromAlert(alertId: string, actorId: string, justification?: string) {
  const alert = await prisma.riskAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new ApiError(404, "PAYMENT_ERROR", "Risk alert not found.");
  const existing = await prisma.fraudCase.findFirst({ where: { alertId } });
  if (existing) return caseView(existing);
  const row = await prisma.fraudCase.create({
    data: {
      caseNumber: `FCASE-${randomUUID().slice(0, 12).toUpperCase()}`,
      userId: alert.userId,
      alertId: alert.id,
      riskScore: alert.score,
      status: "OPEN",
      priority: alert.severity === "CRITICAL" ? "CRITICAL" : alert.severity === "HIGH" ? "HIGH" : "MEDIUM",
      assignedTo: actorId,
      evidence: {
        create: {
          kind: "RISK_ALERT",
          reference: alert.reference,
          payload: { score: alert.score, triggeredRules: alert.triggeredRules } as Prisma.InputJsonValue,
        },
      },
    },
    include: { evidence: true },
  });
  await prisma.riskAlert.update({ where: { id: alertId }, data: { status: "INVESTIGATING" } });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_CASE_OPENED",
    targetType: "fraud_case", targetId: row.id, justification,
    metadata: { alertId, riskScore: alert.score },
  });
  return caseView(row);
}

export async function createManualCase(input: {
  userId?: string; transactionRef?: string; riskScore: number; priority: string; reason: string; actorId: string;
}) {
  const row = await prisma.fraudCase.create({
    data: {
      caseNumber: `FCASE-${randomUUID().slice(0, 12).toUpperCase()}`,
      userId: input.userId ?? null,
      transactionRef: input.transactionRef ?? null,
      riskScore: input.riskScore,
      priority: input.priority as never,
      status: "OPEN",
      assignedTo: input.actorId,
      evidence: { create: { kind: "MANUAL", reference: input.actorId, payload: { reason: input.reason } as Prisma.InputJsonValue } },
    },
  });
  await securityAudit({
    actorType: "ADMIN", actorId: input.actorId, action: "FRAUD_CASE_OPENED",
    targetType: "fraud_case", targetId: row.id, justification: input.reason,
  });
  return caseView(row);
}

export async function getCase(id: string) {
  const row = await prisma.fraudCase.findFirst({ where: { OR: [{ id }, { caseNumber: id }] }, include: { evidence: true, notes: { orderBy: { createdAt: "desc" } }, assignments: { orderBy: { createdAt: "desc" } } } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Fraud case not found.");
  return {
    ...caseView(row),
    evidence: row.evidence,
    // Internal notes are returned only to authorized Control callers.
    notes: row.notes,
    assignments: row.assignments,
  };
}

export async function listCases(status?: string, limit = 100) {
  const rows = await prisma.fraudCase.findMany({
    where: status ? { status: status as FraudCaseStatusEnum } : undefined,
    orderBy: { createdAt: "desc" }, take: limit,
  });
  return rows.map(caseView);
}

export async function transitionCase(id: string, target: FraudCaseStatus, actorId: string, justification?: string) {
  const row = await prisma.fraudCase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Fraud case not found.");
  if (!TRANSITIONS[row.status as FraudCaseStatus].includes(target)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot move a case from ${row.status} to ${target}.`);
  }
  const updated = await prisma.fraudCase.update({
    where: { id },
    data: {
      status: target,
      ...(["RESOLVED", "FALSE_POSITIVE", "CLOSED"].includes(target) ? { resolvedAt: new Date() } : {}),
    },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_CASE_STATUS_CHANGED",
    targetType: "fraud_case", targetId: id, justification,
    metadata: { from: row.status, to: target },
  });
  return caseView(updated);
}

export async function assignCase(id: string, assigneeId: string, actorId: string, justification?: string) {
  const row = await prisma.fraudCase.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Fraud case not found.");
  await prisma.$transaction([
    prisma.fraudCase.update({ where: { id }, data: { assignedTo: assigneeId } }),
    prisma.fraudCaseAssignment.create({ data: { caseId: id, fromUserId: row.assignedTo, toUserId: assigneeId, assignedBy: actorId } }),
  ]);
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_CASE_ASSIGNED",
    targetType: "fraud_case", targetId: id, justification, metadata: { assigneeId },
  });
  return getCase(id);
}

export async function addCaseNote(id: string, body: string, internal: boolean, actorId: string) {
  const note = await prisma.fraudCaseNote.create({
    data: { caseId: id, authorId: actorId, body, internal },
  });
  await securityAudit({
    actorType: "ADMIN", actorId, action: "FRAUD_CASE_NOTE_ADDED",
    targetType: "fraud_case", targetId: id, metadata: { internal },
  });
  return note;
}

export async function escalateCase(id: string, actorId: string, justification?: string) {
  return transitionCase(id, "ESCALATED", actorId, justification);
}

export async function resolveCase(id: string, resolution: "RESOLVED" | "FALSE_POSITIVE" | "CLOSED", notes: string, actorId: string) {
  const updated = await transitionCase(id, resolution, actorId, notes);
  await prisma.fraudCase.update({ where: { id }, data: { resolution: notes.slice(0, 500) } });
  if (resolution === "FALSE_POSITIVE") {
    await prisma.securityAuditEvent.create({
      data: {
        actorType: "ADMIN", actorId, action: "FRAUD_CASE_FALSE_POSITIVE",
        targetType: "fraud_case", targetId: id, justification: notes,
      },
    });
  }
  return updated;
}

export const CASE_TRANSITIONS = TRANSITIONS;
