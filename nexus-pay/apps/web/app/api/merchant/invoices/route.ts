import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { listInvoicesForMerchant } from "@/lib/subscription/invoice-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const status = request.nextUrl.searchParams.get("status") ?? undefined;
    return jsonOk({ items: await listInvoicesForMerchant(user.id, status) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
