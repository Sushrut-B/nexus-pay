import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import {
  executePaymentIntent,
  getOrCreatePaymentIntent,
} from "@/lib/payments/payment-service";
import { sendPaymentSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(
      `payment-send:${auth.user.id}`,
      8,
      60 * 1000,
      "Too many payment attempts. Please wait before trying again.",
    );

    const input = sendPaymentSchema.parse(await readJsonBody(request));
    const created = await getOrCreatePaymentIntent(auth.user.id, input);

    const final =
      created.status === "SETTLED" || created.status === "REJECTED"
        ? created
        : await executePaymentIntent(created.id, auth.user.id);

    return jsonOk(final, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
