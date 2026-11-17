import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { removeGroupMember } from "@/lib/social/group-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ groupId: string; userId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId, userId } = await context.params;
    await removeGroupMember(auth.user.id, groupId, userId);
    return jsonOk({ removed: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
