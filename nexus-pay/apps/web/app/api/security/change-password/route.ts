import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser, revokeCurrentSession } from "@/lib/auth/session";
import { changePasswordSchema } from "@nexus/validation";
import { changePassword } from "@/lib/identity/password-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`security-password:${auth.user.id}`, 3, 15 * 60_000, "Too many password changes.");
    const input = changePasswordSchema.parse(await readJsonBody(request));
    const result = await changePassword({
      userId: auth.user.id, sessionId: auth.sessionId,
      currentPassword: input.currentPassword, grantToken: input.grantToken,
      newPassword: input.newPassword, revokeOtherSessions: input.revokeOtherSessions,
    });
    if (input.revokeOtherSessions === false) return jsonOk(result, requestId);
    await revokeCurrentSession();
    return jsonOk({ ...result, redirectTo: "/login?password=changed" }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
