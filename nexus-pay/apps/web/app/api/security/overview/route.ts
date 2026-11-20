import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");

    const since = new Date(Date.now() - 86400000);
    const [events, evaluations, alerts, reports] = await Promise.all([
      prisma.securityEvent.count({ where: { actorId: auth.user.id, occurredAt: { gte: since } } }),
      prisma.riskEvaluation.count({ where: { userId: auth.user.id, createdAt: { gte: since } } }),
      prisma.riskAlert.count({ where: { userId: auth.user.id, status: { in: ["NEW", "ACKNOWLEDGED", "INVESTIGATING"] } } }),
      prisma.customerFraudReport.count({ where: { userId: auth.user.id } }),
    ]);
    return jsonOk({ events24h: events, evaluations24h: evaluations, activeAlerts: alerts, reports, currency: "INR",
      notice: "Risk scores are indicators, not proof of fraud. No automatic account blocking or fund freezing is performed." }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
