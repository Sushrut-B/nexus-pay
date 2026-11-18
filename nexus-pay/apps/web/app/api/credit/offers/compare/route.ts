import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { compareOffers } from "@/lib/credit/catalog-service";
import { z } from "zod";

const schema = z.object({ offerIds: z.array(z.string().min(1).max(64)).min(2).max(4) });

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`credit-compare:${user.id}`, 20, 60_000);
    const input = schema.parse(await readJsonBody(request));
    return jsonOk(await compareOffers(input.offerIds), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
