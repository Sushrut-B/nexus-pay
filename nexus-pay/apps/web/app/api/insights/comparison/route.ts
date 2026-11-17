import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getSpendingAnalytics } from "@/lib/finance/analytics-service";
import { insightQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const query = insightQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const spending = await getSpendingAnalytics(auth.user.id, query.period, query.from, query.to);
    return jsonOk(
      {
        totalSpentMinor: spending.totalSpentMinor,
        previousTotalSpentMinor: spending.previousTotalSpentMinor,
        changeMinor: spending.changeMinor,
        changePercentage: spending.changePercentage,
        transactionCount: spending.transactionCount,
        period: {
          start: spending.period.start.toISOString(),
          end: spending.period.end.toISOString(),
          label: spending.period.label,
          previousStart: spending.period.previousStart.toISOString(),
          previousEnd: spending.period.previousEnd.toISOString(),
        },
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
