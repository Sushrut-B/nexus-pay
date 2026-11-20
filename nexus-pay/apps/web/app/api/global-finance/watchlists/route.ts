import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { currencyWatchlistSchema } from "@nexus/validation";
import { listWatchlists, createWatchlist } from "@/lib/global/watchlist-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk({ watchlists: await listWatchlists(auth.user.id) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 20, 60000);
    const input = currencyWatchlistSchema.parse(await readJsonBody(request));
    return jsonOk(await createWatchlist(auth.user.id, input), requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
