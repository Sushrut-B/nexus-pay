import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { createRule } from "@/lib/fraud/rule-admin-service";
import { fraudRuleSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("fraud:rules"), request);
    enforceRateLimitOrThrow("fraud-write:" + admin.id, 20, 60000);

    const body = await readJsonBody(request);
    return jsonOk(await createRule(fraudRuleSchema.parse(body), admin.id), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

