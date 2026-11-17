import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listTransactions } from "@/lib/payments/transaction-service";
import { historyQuerySchema } from "@nexus/validation";

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
      `transaction-history:${auth.user.id}`,
      60,
      60 * 1000,
      "Too many history refreshes. Please wait a moment.",
    );

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = historyQuerySchema.parse(params);
    const result = await listTransactions(auth.user.id, query);
    return jsonOk(result, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
