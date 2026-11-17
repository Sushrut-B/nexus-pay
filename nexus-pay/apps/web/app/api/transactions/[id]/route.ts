import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getTransactionDetail } from "@/lib/payments/transaction-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns transaction detail by ledger payment reference or by internal record
 * id. Ownership is enforced by the service before any data is returned.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }
    enforceRateLimitOrThrow(
      `transaction-detail:${auth.user.id}`,
      120,
      60 * 1000,
      "Too many transaction checks. Please wait a moment.",
    );
    const { id } = await context.params;
    return jsonOk(await getTransactionDetail(auth.user.id, id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
