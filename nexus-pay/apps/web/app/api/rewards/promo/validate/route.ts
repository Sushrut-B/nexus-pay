import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { validatePromoCode } from "@/lib/rewards/promo-service";
import { rewardPromoValidateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`promo-validate:${user.id}`, 20, 60_000);
    const input = rewardPromoValidateSchema.parse(await readJsonBody(request));
    return jsonOk(await validatePromoCode(user.id, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
