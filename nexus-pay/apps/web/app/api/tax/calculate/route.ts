import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { calculateAndStore } from "@/lib/tax/tax-service";
import { taxCalculateSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const input = taxCalculateSchema.parse(await readJsonBody(request));
    const fy = input.financialYear; const result = await calculateAndStore(auth.user.id, fy, input.regime ?? "NEW", input); return jsonOk(result, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
