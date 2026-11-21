import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { mfaConfirmSchema } from "@nexus/validation";
import { confirmTotpEnrollment } from "@/lib/identity/mfa-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`security-mfa-confirm:${auth.user.id}`, 10, 15 * 60_000);
    const input = mfaConfirmSchema.parse(await readJsonBody(request));
    return jsonOk(await confirmTotpEnrollment(auth.user.id, auth.sessionId, input.enrollmentId, input.code), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
