import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("diagnostics:read");
    const [auditFailures, failedPayments, chaosEvents, unresolved] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where: { outcome: { in: ["FAILURE", "BLOCKED"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.paymentIntent.findMany({
        where: { status: { in: ["UNKNOWN", "RECONCILIATION_REQUIRED", "REJECTED"] } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: { id: true, status: true, rejectionCode: true, failureMessage: true, updatedAt: true },
      }),
      prisma.chaosOperationEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.reconciliationCase.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "UNRESOLVED"] } } }),
    ]);

    return jsonOk(
      {
        items: [
          ...auditFailures.map((item) => ({
            id: item.id,
            service: "nexus-control",
            severity: "warning",
            operation: item.action,
            outcome: item.outcome,
            summary: item.reason ?? `${item.targetType}: ${item.targetId}`,
            correlationId: item.requestId,
            timestamp: item.createdAt.toISOString(),
          })),
          ...failedPayments.map((item) => ({
            id: item.id,
            service: "payment-engine",
            severity: item.status === "REJECTED" ? "error" : "warning",
            operation: "SETTLEMENT",
            outcome: item.status,
            summary: item.failureMessage ?? item.rejectionCode ?? "Unverified payment outcome",
            correlationId: item.id,
            timestamp: item.updatedAt.toISOString(),
          })),
          ...chaosEvents.map((item) => ({
            id: item.id,
            service: "raftline-chaos",
            severity: item.eventType === "FAILED" ? "error" : "info",
            operation: item.eventType,
            outcome: item.eventType,
            summary: item.message,
            correlationId: item.operationId,
            timestamp: item.createdAt.toISOString(),
          })),
        ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 100),
        unresolvedReconciliations: unresolved,
        note: "Structured observations only. No raw secrets, tokens or full payloads are included.",
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
