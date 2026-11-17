import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getFundingViewByClientRequestId } from "@/lib/payments/funding-service";
import { clientRequestIdSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }
    enforceRateLimitOrThrow(
      `funding-recovery:${auth.user.id}`,
      60,
      60 * 1000,
      "Too many funding checks. Please wait a moment.",
    );

    const parsed = clientRequestIdSchema.safeParse(
      request.nextUrl.searchParams.get("clientRequestId") ?? "",
    );
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "The funding request reference is invalid.");
    }

    return jsonOk(
      await getFundingViewByClientRequestId(auth.user.id, parsed.data),
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
