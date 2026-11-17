import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import {
  deleteScheduledPayment,
  getScheduledPayment,
  updateScheduledPayment,
} from "@/lib/finance/scheduled-payment-service";
import { scheduledPaymentUpdateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    return jsonOk(await getScheduledPayment(auth.user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    const input = scheduledPaymentUpdateSchema.parse(await readJsonBody(request));
    return jsonOk(await updateScheduledPayment(auth.user.id, id, input), requestId);
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
    const { id } = await context.params;
    await deleteScheduledPayment(auth.user.id, id);
    return jsonOk({ removed: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
