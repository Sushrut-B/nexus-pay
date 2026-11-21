import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { z } from "zod";
import { consumeStepUpGrant, beginTotpEnrollment } from "@/lib/identity/mfa-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ grantToken: z.string().min(8).max(256) });

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`security-mfa:${auth.user.id}`, 5, 15 * 60_000);
    const input = schema.parse(await readJsonBody(request));
    await consumeStepUpGrant(auth.user.id, auth.sessionId, "MFA_ENROLL", input.grantToken);
    return jsonOk(await beginTotpEnrollment(auth.user.id, auth.sessionId), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
