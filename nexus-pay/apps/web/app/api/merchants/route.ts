import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { createMerchant, getMerchantStatus } from "@/lib/merchant/merchant-service";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { merchantCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const input = merchantCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createMerchant(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const merchant = await getMerchantStatus(user.id);
    if (!merchant) throw new ApiError(404, "PAYMENT_ERROR", "No merchant account found.");
    return jsonOk(merchant, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
