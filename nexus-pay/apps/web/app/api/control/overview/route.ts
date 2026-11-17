import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { collectClusterSnapshot, enrichOverview, getLatestOverview } from "@/lib/control/collector";
import { requireControl, withRequest } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const context = withRequest(await requireControl("cluster:read"), request);
    void context;
    let overview;
    try {
      overview = await collectClusterSnapshot();
    } catch {
      overview = await getLatestOverview();
    }
    if (!overview) throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "No cluster observations are available yet.");
    return jsonOk(await enrichOverview(overview), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
