import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
import { verifyPassword } from "@/lib/security/passwords";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";
import { sensitiveActionSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Step-up verification using the password already in the application. MFA is not implemented. */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`sensitive-action:${auth.user.id}`, 5, 60_000, "Too many verification attempts.");
    const input = sensitiveActionSchema.parse(await readJsonBody(request));
    const valid = await verifyPassword(input.password, auth.user.passwordHash);
    if (!valid) {
      await publishSecurityEvent({
        eventId: `sensitive_fail_${requestId}`, type: "SENSITIVE_ACTION_VERIFICATION_FAILED", occurredAt: new Date(),
        actorId: auth.user.id, sessionId: auth.sessionId, sourceModule: "security",
        requestId, metadata: { mechanism: "PASSWORD_REAUTH", action: input.action },
      });
      await securityAudit({
        actorType: "USER", actorId: auth.user.id, action: "SENSITIVE_ACTION_VERIFICATION_FAILED",
        targetType: "sensitive_action", targetId: input.action, outcome: "FAILURE",
      });
      throw new ApiError(403, "AUTHORIZATION_ERROR", "Verification failed.");
    }
    const token = `verified_${requestId}_${auth.user.id}`;
    await publishSecurityEvent({
      eventId: `sensitive_ok_${requestId}`, type: "SENSITIVE_ACTION_VERIFIED", occurredAt: new Date(),
      actorId: auth.user.id, sessionId: auth.sessionId, sourceModule: "security",
      requestId, metadata: { mechanism: "PASSWORD_REAUTH", action: input.action, verified: true },
    });
    await securityAudit({
      actorType: "USER", actorId: auth.user.id, action: "SENSITIVE_ACTION_VERIFIED",
      targetType: "sensitive_action", targetId: input.action, justification: input.reason,
    });
    // A verification token is held server-side only, scoped to this session.
    await prisma.userSessionRisk.upsert({
      where: { sessionId: auth.sessionId },
      create: { sessionId: auth.sessionId, userId: auth.user.id, flags: { lastVerifiedAction: input.action, verifiedAt: new Date().toISOString() } },
      update: { flags: { lastVerifiedAction: input.action, verifiedAt: new Date().toISOString() } },
    });
    return jsonOk({ verified: true, token, action: input.action, notice: "This verification applies to the current sensitive action only." }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
