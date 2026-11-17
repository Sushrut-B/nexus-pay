import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { listMerchantPayments } from "@/lib/merchant/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    return jsonOk({ items: await listMerchantPayments(user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

