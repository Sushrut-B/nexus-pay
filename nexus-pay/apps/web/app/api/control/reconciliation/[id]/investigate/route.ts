import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { investigateReconciliation } from "@/lib/control/payment-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("reconciliation:write"), request);
    const { id } = await context.params;
    return jsonOk(await investigateReconciliation(id, admin, requestId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
