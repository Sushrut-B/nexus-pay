import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getHistoricalRates } from "@/lib/global/fx-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 30, 60000);
    const base = request.nextUrl.searchParams.get("base") ?? "";
    const quote = request.nextUrl.searchParams.get("quote") ?? "";
    const toParam = request.nextUrl.searchParams.get("to");
    const fromParam = request.nextUrl.searchParams.get("from");
    const to = toParam ? new Date(toParam) : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * 86400000);
    return jsonOk({ rates: await getHistoricalRates(base, quote, from, to) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
