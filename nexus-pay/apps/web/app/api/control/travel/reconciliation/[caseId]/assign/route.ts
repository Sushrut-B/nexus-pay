import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { assignTravelCase } from "@/lib/travel/travel-control-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("travel:write"), request);
    enforceRateLimitOrThrow("travel-admin:" + admin.id, 20, 60000);
    const { caseId } = await context.params;
    const body = await readJsonBody(request);
    const input = body as { assigneeId: string };
    return jsonOk(await assignTravelCase(caseId, input.assigneeId, admin.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
