import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { updateRule } from "@/lib/fraud/rule-admin-service";
import { fraudRuleUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ ruleId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:rules"), request);
    const { ruleId } = await context.params;
    const body = await readJsonBody(request) as { justification?: string };
    const input = fraudRuleUpdateSchema.parse(body);
    return jsonOk(await updateRule(ruleId, input, admin.id, body.justification), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

