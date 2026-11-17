import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { createOrder, listOrders } from "@/lib/merchant/order-service";
import { merchantOrderCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const status = request.nextUrl.searchParams.get("status");
    return jsonOk({ items: await listOrders(user.id, status ? { status: status as never } : {}) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    const input = merchantOrderCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createOrder(user.id, input), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
