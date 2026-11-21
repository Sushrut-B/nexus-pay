import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ensureHelpCategories, listArticles } from "@/lib/support/help-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 30, 60000);
    const q = request.nextUrl.searchParams;
    await ensureHelpCategories();
    return jsonOk({
      categories: await ensureHelpCategories(),
      articles: await listArticles({ categoryCode: q.get("category") ?? undefined, search: q.get("search") ?? undefined }, auth.user.id),
    }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
