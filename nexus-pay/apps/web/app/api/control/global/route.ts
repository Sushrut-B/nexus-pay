import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { getOperations } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const context = withRequest(await requireControl("global:read"), request);
    enforceRateLimitOrThrow("global-control:" + context.id, 30, 60000);
    return jsonOk(await getOperations(), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
