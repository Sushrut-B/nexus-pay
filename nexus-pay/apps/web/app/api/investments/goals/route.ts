import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { createGoal } from "@/lib/investments/planning-service";
import { investmentGoalSchema } from "@nexus/validation";
import { listGoals } from "@/lib/investments/planning-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);

    return jsonOk(await createGoal(auth.user.id, investmentGoalSchema.parse(await readJsonBody(request))), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk({ items: await listGoals(auth.user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
