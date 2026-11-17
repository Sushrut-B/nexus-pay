import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { declineRequest } from "@/lib/social/request-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    return jsonOk(await declineRequest(auth.user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
