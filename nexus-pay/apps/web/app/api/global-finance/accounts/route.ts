import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { currencyAccountSchema } from "@nexus/validation";
import { listGlobalAccounts, createGlobalAccount } from "@/lib/global/global-accounts-service";
import { getDisplayCurrency } from "@/lib/global/global-dashboard-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 25, 60000);
    return jsonOk({ accounts: await listGlobalAccounts(auth.user.id, await getDisplayCurrency(auth.user.id)) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("global:" + auth.user.id, 20, 60000);
    const input = currencyAccountSchema.parse(await readJsonBody(request));
    const id = await createGlobalAccount(auth.user.id, input);
    return jsonOk({ id }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
