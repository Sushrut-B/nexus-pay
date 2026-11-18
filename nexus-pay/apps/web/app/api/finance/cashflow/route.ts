import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getCashFlow } from "@/lib/finance-intelligence/aggregation-service";
import { financeQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const query = financeQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    return jsonOk(await getCashFlow(user.id, query.period, query.from, query.to), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
