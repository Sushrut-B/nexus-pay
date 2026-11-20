import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { calculateSipProjection, savePlan } from "@/lib/investments/planning-service";
import { sipCalculatorSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);

    const input = sipCalculatorSchema.parse(await readJsonBody(request));
    const projection = calculateSipProjection(input); await savePlan(auth.user.id, input, projection); return jsonOk(projection, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
