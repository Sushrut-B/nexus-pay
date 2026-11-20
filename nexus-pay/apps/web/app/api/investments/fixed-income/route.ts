import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { createFixedIncome } from "@/lib/investments/wealth-service";
import { fixedIncomeSchema } from "@nexus/validation";
import { listFixedIncome } from "@/lib/investments/wealth-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);

    return jsonOk(await createFixedIncome(auth.user.id, fixedIncomeSchema.parse(await readJsonBody(request))), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk({ items: await listFixedIncome(auth.user.id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
