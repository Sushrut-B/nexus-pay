import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getSubscriptionIntelligence } from "@/lib/finance-intelligence/subscription-intelligence-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    return jsonOk(await getSubscriptionIntelligence(user.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
