import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { currencyWatchlistUpdateSchema } from "@nexus/validation";
import { updateWatchlist, deleteWatchlist } from "@/lib/global/watchlist-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 20, 60000);
    const { id } = await context.params;
    const input = currencyWatchlistUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateWatchlist(auth.user.id, id, input), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    await deleteWatchlist(auth.user.id, id);
    return jsonOk({ deleted: true }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
