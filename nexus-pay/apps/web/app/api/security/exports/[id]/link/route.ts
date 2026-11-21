import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getExportLink } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-export-link:" + auth.user.id, 20, 60000);
    const { id } = await context.params;
    return jsonOk({ url: await getExportLink(auth.user.id, id) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
