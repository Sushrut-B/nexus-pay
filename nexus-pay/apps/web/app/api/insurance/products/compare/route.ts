import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { compareProducts } from "@/lib/insurance/catalog-service";
import { insuranceCompareSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`insurance-compare:${user.id}`, 20, 60_000);
    const input = insuranceCompareSchema.parse(await readJsonBody(request));
    return jsonOk(await compareProducts(input.productIds), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
