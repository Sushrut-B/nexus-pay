import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { revalidateResult } from "@/lib/travel/search-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("travel-write:" + auth.user.id, 20, 60000);
    const body = await readJsonBody(request) as { searchId?: string; resultId?: string };
    if (!body.searchId || !body.resultId) throw new ApiError(400, "VALIDATION_ERROR", "searchId and resultId are required.");
    return jsonOk(await revalidateResult(auth.user.id, body.searchId, body.resultId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

