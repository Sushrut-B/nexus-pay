import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { listProducts } from "@/lib/credit/catalog-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireMerchantUser();
    return jsonOk({ items: await listProducts(request.nextUrl.searchParams.get("type") ?? undefined) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
