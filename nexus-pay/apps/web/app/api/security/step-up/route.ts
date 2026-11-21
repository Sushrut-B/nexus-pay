import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { stepUpRequestSchema } from "@nexus/validation";
import { verifyPassword } from "@/lib/security/passwords";
import { issueStepUpGrant } from "@/lib/identity/mfa-service";
import { publishIdentityEvent } from "@/lib/identity/identity-audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`security-stepup:${auth.user.id}`, 5, 60_000, "Too many verification attempts.");
    const input = stepUpRequestSchema.parse(await readJsonBody(request));
    if (!(await verifyPassword(input.password, auth.user.passwordHash))) {
      await publishIdentityEvent({ type: "STEP_UP_FAILED", userId: auth.user.id, sessionId: auth.sessionId, metadata: { action: input.action } });
      throw new ApiError(403, "AUTHORIZATION_ERROR", "Verification failed.");
    }
    return jsonOk(await issueStepUpGrant(auth.user.id, auth.sessionId, input.action), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
