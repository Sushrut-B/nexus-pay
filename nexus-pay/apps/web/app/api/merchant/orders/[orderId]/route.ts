import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { cancelOrder, getOrderForUser } from "@/lib/merchant/order-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { orderId } = await context.params;
    return jsonOk(await getOrderForUser(user.id, orderId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const { orderId } = await context.params;
    return jsonOk(await cancelOrder(user.id, orderId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
