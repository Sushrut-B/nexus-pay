import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireControl, withRequest } from "@/lib/control/api-guard";
import { healChaosOperation } from "@/lib/control/chaos-service";
import { chaosHealSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const admin = withRequest(await requireControl("chaos:heal"), request);
    enforceRateLimitOrThrow(`control-chaos:${admin.id}`, 5, 60_000, "Too many chaos operations. Slow down.");
    const input = chaosHealSchema.parse(await readJsonBody(request));
    return jsonOk(await healChaosOperation(admin, input, requestId), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
