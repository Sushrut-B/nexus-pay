import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getWalletOverviewForUser } from "@/lib/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }

    enforceRateLimitOrThrow(`wallet-status:${auth.user.id}`, 120, 60 * 1000);

    const overview = await getWalletOverviewForUser(auth.user.id);
    if (!overview) {
      throw new ApiError(404, "DATABASE_ERROR", "No wallet is associated with this account.");
    }

    return jsonOk(overview, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
