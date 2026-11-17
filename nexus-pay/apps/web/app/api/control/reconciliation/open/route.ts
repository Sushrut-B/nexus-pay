import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { openReconciliationCase } from "@/lib/control/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("reconciliation:write"), request);
    const body = (await readJsonBody(request)) as { intentId?: string };
    if (!body.intentId) throw new Error("A payment intent id is required.");
    return jsonOk(await openReconciliationCase(body.intentId, admin, requestId), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
