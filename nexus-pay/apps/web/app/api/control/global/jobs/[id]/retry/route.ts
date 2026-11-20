import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { retryReadOnlyJob } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("global:write"), request);
    enforceRateLimitOrThrow("global-control:" + admin.id, 15, 60000);
    const { id } = await context.params;
    const job = await retryReadOnlyJob(admin.id, id);
    return jsonOk({ id: job.id, status: job.status }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
