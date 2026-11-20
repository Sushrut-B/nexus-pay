import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { prisma } from "@nexus/database";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { sessionId } = await context.params;
    const session = await prisma.userSession.findFirst({ where: { id: sessionId, userId: auth.user.id, revokedAt: null } });
    if (!session) throw new ApiError(404, "AUTHORIZATION_ERROR", "Session not found.");
    await prisma.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    await prisma.userSessionRisk.updateMany({ where: { sessionId }, data: { classification: "LOW", score: 0 } });
    await publishSecurityEvent({
      eventId: `session_revoke_${requestId}_${sessionId}`, type: "SESSION_REVOKED", occurredAt: new Date(),
      actorId: auth.user.id, sessionId, sourceModule: "security", requestId,
      metadata: { reason: "USER_REVOKED" },
    });
    await securityAudit({
      actorType: "USER", actorId: auth.user.id, action: "SESSION_REVOKED",
      targetType: "user_session", targetId: sessionId,
    });
    return jsonOk({ sessionId, revoked: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
