import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { getMerchantStatus, updateMerchant } from "@/lib/merchant/merchant-service";
import { merchantUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    return jsonOk((await getMerchantStatus(user.id)) ?? { status: "NONE" }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const input = merchantUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateMerchant(user.id, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
