import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { createClaim, listClaims } from "@/lib/insurance/claim-service";
import { insuranceClaimCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    return jsonOk({ items: await listClaims(user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`insurance-claim:${user.id}`, 10, 60_000);
    const input = insuranceClaimCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createClaim(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
