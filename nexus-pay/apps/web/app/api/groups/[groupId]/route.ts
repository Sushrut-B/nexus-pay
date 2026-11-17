import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getGroupDetail, updateGroup } from "@/lib/social/group-service";
import { groupUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId } = await context.params;
    return jsonOk(await getGroupDetail(auth.user.id, groupId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId } = await context.params;
    const input = groupUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateGroup(auth.user.id, groupId, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
