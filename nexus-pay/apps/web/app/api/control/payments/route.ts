import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listPaymentOperations } from "@/lib/control/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("payments:read");
    const params = request.nextUrl.searchParams;
    const items = await listPaymentOperations({
      paymentRef: params.get("paymentRef") ?? undefined,
      intentId: params.get("intentId") ?? undefined,
      idempotencyKey: params.get("idempotencyKey") ?? undefined,
      status: params.get("status") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return jsonOk({ items }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
