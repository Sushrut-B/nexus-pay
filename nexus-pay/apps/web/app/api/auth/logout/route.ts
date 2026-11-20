import type { NextRequest } from "next/server";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser, revokeCurrentSession } from "@/lib/auth/session";
import { publishSecurityEvent } from "@/lib/fraud/event-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    await revokeCurrentSession();

    if (auth) {
      await recordAudit({
        actorId: auth.user.id,
        action: AUDIT_ACTIONS.USER_LOGGED_OUT,
        entityType: "user_session",
        entityId: auth.sessionId,
      });
      await publishSecurityEvent({
        eventId: `logout_${requestId}`,
        type: "LOGOUT",
        occurredAt: new Date(),
        actorId: auth.user.id,
        sessionId: auth.sessionId,
        sourceModule: "auth",
        requestId,
        metadata: { outcome: "SUCCESS" },
      });
      await publishSecurityEvent({
        eventId: `session_revoke_${requestId}`,
        type: "SESSION_REVOKED",
        occurredAt: new Date(),
        actorId: auth.user.id,
        sessionId: auth.sessionId,
        sourceModule: "auth",
        requestId,
        metadata: { reason: "LOGOUT" },
      });
    }

    return jsonOk({ redirectTo: "/" }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
