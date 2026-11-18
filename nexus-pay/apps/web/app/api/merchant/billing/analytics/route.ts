import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getSubscriptionAnalytics } from "@/lib/subscription/subscription-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const params = request.nextUrl.searchParams;
    const analytics = await getSubscriptionAnalytics(
      user.id,
      params.get("range") ?? "month",
      params.get("from") ?? undefined,
      params.get("to") ?? undefined,
    );
    return jsonOk(analytics, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
