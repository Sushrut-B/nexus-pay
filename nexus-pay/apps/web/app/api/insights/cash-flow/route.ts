import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getFinanceOverview } from "@/lib/finance/analytics-service";
import { insightQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const query = insightQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const overview = await getFinanceOverview(auth.user.id, query.period, query.from, query.to);
    return jsonOk(
      { cashFlow: overview.cashFlow, weekly: overview.weekly, daily: overview.daily, generatedAt: overview.generatedAt },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
