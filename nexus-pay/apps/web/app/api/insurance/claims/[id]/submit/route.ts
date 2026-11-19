import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { submitClaim } from "@/lib/insurance/claim-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow(`insurance-claim-submit:${user.id}`, 10, 60_000);
    const { id } = await context.params;
    return jsonOk(await submitClaim(user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
