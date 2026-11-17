import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getCategoryTransactions } from "@/lib/finance/analytics-service";
import { insightQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const params = request.nextUrl.searchParams;
    const query = insightQuerySchema.parse(Object.fromEntries(params.entries()));
    const categoryId = params.get("categoryId") ?? "";
    if (!categoryId) throw new ApiError(400, "VALIDATION_ERROR", "Choose a category.");
    const minRaw = params.get("minMinor");
    const maxRaw = params.get("maxMinor");
    const direction = params.get("direction");
    return jsonOk(
      {
        items: await getCategoryTransactions(
          auth.user.id,
          categoryId,
          query.period,
          query.from,
          query.to,
          {
            search: params.get("search") ?? undefined,
            minMinor: minRaw ? Number(minRaw) : undefined,
            maxMinor: maxRaw ? Number(maxRaw) : undefined,
            direction: direction === "SENT" || direction === "RECEIVED" ? direction : undefined,
          },
        ),
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
