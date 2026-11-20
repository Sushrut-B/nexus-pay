import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { acknowledgeAlert } from "@/lib/fraud/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ alertId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:write"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);
    const { alertId } = await context.params;

    return jsonOk(await acknowledgeAlert(alertId, admin.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}


