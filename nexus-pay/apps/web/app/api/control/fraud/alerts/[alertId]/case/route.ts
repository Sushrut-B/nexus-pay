import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { createCaseFromAlert } from "@/lib/fraud/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ alertId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:write"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);
    const { alertId } = await context.params;
    const body = await readJsonBody(request);
    const reason = (body as { reason?: string }).reason;
    return jsonOk(await createCaseFromAlert(alertId, admin.id, reason), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

