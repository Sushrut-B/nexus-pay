import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { listLenderProviders } from "@/lib/credit/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireMerchantUser();
    return jsonOk({ items: listLenderProviders() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
