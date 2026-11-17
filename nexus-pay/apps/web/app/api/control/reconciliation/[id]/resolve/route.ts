import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { resolveReconciliation } from "@/lib/control/payment-service";
import { reconciliationResolveSchema } from "@nexus/validation";

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
    const input = reconciliationResolveSchema.parse(await readJsonBody(request));
    return jsonOk(await resolveReconciliation(id, input, admin, requestId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
