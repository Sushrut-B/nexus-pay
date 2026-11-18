import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getAccountAnalytics } from "@/lib/accounts/accounts-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const analytics = await getAccountAnalytics(user.id, "ALL");
    return jsonOk({ items: analytics.accountBreakdown, cashBalanceMinor: analytics.cashBalanceMinor, liabilityMinor: analytics.liabilityMinor, notice: analytics.notice }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
