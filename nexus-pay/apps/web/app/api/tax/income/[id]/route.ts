import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { updateIncome, deleteIncome } from "@/lib/tax/tax-mapping-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    return jsonOk(await updateIncome(auth.user.id, id, await readJsonBody(request) as never), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    return jsonOk(await deleteIncome(auth.user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
