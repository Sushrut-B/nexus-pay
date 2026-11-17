import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { collectClusterSnapshot, getLatestOverview } from "@/lib/control/collector";
import { requireControl } from "@/lib/control/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    await requireControl("cluster:read");
    const overview = await collectClusterSnapshot().catch(() => getLatestOverview());
    if (!overview) throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Cluster status is unavailable.");
    return jsonOk(overview, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
