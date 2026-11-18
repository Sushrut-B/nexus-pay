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
    return jsonOk({
      inflowMinor: analytics.inflowMinor,
      outflowMinor: analytics.outflowMinor,
      netMinor: analytics.inflowMinor - analytics.outflowMinor,
      excludedInternalTransfersMinor: analytics.excludedInternalTransfersMinor,
      notice: analytics.notice,
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
