import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getWalletBalanceForUser } from "@/lib/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      `wallet-balance:${auth.user.id}`,
      120,
      60 * 1000,
      "Too many balance refreshes. Please wait a moment.",
    );
    const { id } = await context.params;
    const overview = await getWalletBalanceForUser(auth.user.id, id);
    return jsonOk(
      {
        walletId: overview.wallet.id,
        balance: overview.balance,
        balanceUnavailableReason: overview.balanceUnavailableReason,
        fetchedAt: overview.fetchedAt,
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
