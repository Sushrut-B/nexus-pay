import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { updatePolicy } from "@/lib/fraud/rule-admin-service";
import { riskPolicySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ policyId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:risk-policies"), request);
    const { policyId } = await context.params;
    const body = await readJsonBody(request) as { justification?: string };
    const input = riskPolicySchema.parse(body);
    return jsonOk(await updatePolicy(policyId, input, admin.id, body.justification), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

