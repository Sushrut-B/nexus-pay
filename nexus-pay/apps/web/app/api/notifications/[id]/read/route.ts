import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { markNotificationRead } from "@/lib/social/notification-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    await markNotificationRead(auth.user.id, id);
    return jsonOk({ read: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
