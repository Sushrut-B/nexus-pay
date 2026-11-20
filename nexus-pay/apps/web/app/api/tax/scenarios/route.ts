import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listScenarios, createScenario } from "@/lib/tax/tax-service";
import { taxScenarioSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    return jsonOk({ items: await listScenarios(auth.user.id, request.nextUrl.searchParams.get("financialYear") ?? "2025-26") }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const input = taxScenarioSchema.parse(await readJsonBody(request)); return jsonOk(await createScenario(auth.user.id, input.financialYear, input.name, input.inputs), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
