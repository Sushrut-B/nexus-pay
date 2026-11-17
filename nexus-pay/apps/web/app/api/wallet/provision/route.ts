import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { provisionWallet } from "@/lib/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(
      `wallet-provision:${auth.user.id}`,
      8,
      5 * 60 * 1000,
      "Too many wallet setup attempts. Please wait before trying again.",
    );

    const overview = await provisionWallet(auth.user.id);
    return jsonOk(overview, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
