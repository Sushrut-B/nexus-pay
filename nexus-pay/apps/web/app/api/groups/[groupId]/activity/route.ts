import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listGroupActivity } from "@/lib/social/activity-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId } = await context.params;
    return jsonOk(await listGroupActivity(auth.user.id, groupId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
