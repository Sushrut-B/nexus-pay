import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getExpenseSummary } from "@/lib/global/global-expenses-service";
import { getDisplayCurrency } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 25, 60000);
    const display = request.nextUrl.searchParams.get("currency") ?? await getDisplayCurrency(auth.user.id);
    const summary = await getExpenseSummary(auth.user.id, display);
    return jsonOk({
      displayCurrency: display,
      byCurrency: summary.byCurrency,
      notice: summary.notice,
    }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
