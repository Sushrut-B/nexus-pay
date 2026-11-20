import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { removeWatchlistItem } from "@/lib/investments/discovery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; instrumentId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const { instrumentId } = await context.params;
    return jsonOk(await removeWatchlistItem(auth.user.id, id, instrumentId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
