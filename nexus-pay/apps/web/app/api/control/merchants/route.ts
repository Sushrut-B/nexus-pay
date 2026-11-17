import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl } from "@/lib/control/api-guard";
import { listMerchantsForControl } from "@/lib/merchant/merchant-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("cluster:read");
    return jsonOk({ items: await listMerchantsForControl() }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
