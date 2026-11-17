import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listWalletOverviewsForUser } from "@/lib/wallet/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) {
      throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    }
    enforceRateLimitOrThrow(`wallet-list:${auth.user.id}`, 120, 60 * 1000);

    return jsonOk(await listWalletOverviewsForUser(auth.user.id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
