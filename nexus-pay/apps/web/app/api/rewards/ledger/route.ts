import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getRewardLedger } from "@/lib/rewards/rewards-analytics";
import { rewardListQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const query = rewardListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return jsonOk(await getRewardLedger(user.id, query), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
