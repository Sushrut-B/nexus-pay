import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { acknowledgeAlert } from "@/lib/control/alert-service";
import { alertAcknowledgeSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("alerts:write"), request);
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const input = alertAcknowledgeSchema.parse(body);
    return jsonOk(await acknowledgeAlert(id, admin, input.reason, requestId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
