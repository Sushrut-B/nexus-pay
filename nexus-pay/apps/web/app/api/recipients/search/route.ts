import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { recipientSearchSchema } from "@nexus/validation";

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
      `recipient-search:${auth.user.id}`,
      10,
      60 * 1000,
      "Too many recipient searches. Please wait a minute before trying again.",
    );

    const query = recipientSearchSchema.parse({
      q: request.nextUrl.searchParams.get("q") ?? "",
    });
    const recipient = await searchRecipient(auth.user.id, query.q);
    return jsonOk(recipient, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
