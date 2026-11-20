import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getLatestRate, listRecentRates } from "@/lib/global/fx-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 30, 60000);
    const base = request.nextUrl.searchParams.get("base");
    const quote = request.nextUrl.searchParams.get("quote");
    if (base && quote) return jsonOk(await getLatestRate(base, quote), requestId);
    return jsonOk({ rates: await listRecentRates(50) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
