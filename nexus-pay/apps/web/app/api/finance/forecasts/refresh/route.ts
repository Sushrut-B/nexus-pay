import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { generateForecast } from "@/lib/finance-intelligence/forecast-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`forecast-refresh:${user.id}`, 5, 60_000);
    return jsonOk(await generateForecast(user.id, "MONTHLY_EXPENSE", "month"), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
