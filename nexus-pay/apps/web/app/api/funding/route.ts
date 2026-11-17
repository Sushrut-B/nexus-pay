import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import {
  executeFundingOperation,
  getOrCreateFundingOperation,
} from "@/lib/payments/funding-service";
import { fundingRequestSchema } from "@nexus/validation";

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
      `simulated-funding:${auth.user.id}`,
      8,
      5 * 60 * 1000,
      "Too many simulated funding attempts. Please wait before trying again.",
    );

    const input = fundingRequestSchema.parse(await readJsonBody(request));
    const created = await getOrCreateFundingOperation(auth.user.id, input);
    const final =
      created.status === "COMPLETED" || created.status === "FAILED"
        ? created
        : await executeFundingOperation(created.id, auth.user.id);

    return jsonOk(final, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
