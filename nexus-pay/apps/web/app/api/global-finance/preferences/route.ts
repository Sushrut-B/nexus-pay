import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { globalDisplayCurrencySchema } from "@nexus/validation";
import { getDisplayCurrency, setDisplayCurrency } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk({ displayCurrency: await getDisplayCurrency(auth.user.id) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 20, 60000);
    const input = globalDisplayCurrencySchema.parse(await readJsonBody(request));
    return jsonOk({ displayCurrency: await setDisplayCurrency(auth.user.id, input.currency) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
