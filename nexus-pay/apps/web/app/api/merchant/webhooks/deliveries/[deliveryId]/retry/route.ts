import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { retryDelivery } from "@/lib/merchant/webhook-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ deliveryId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { deliveryId } = await context.params;
    return jsonOk(await retryDelivery(user.id, deliveryId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
