import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listFunds } from "@/lib/investments/discovery-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {

    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);

    const q = request.nextUrl.searchParams;
    return jsonOk({ items: await listFunds({ category: q.get("category") ?? undefined, amc: q.get("amc") ?? undefined, q: q.get("q") ?? undefined }) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
