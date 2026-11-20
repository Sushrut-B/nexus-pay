import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { listSecurityEvents } from "@/lib/fraud/event-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");

    const p = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "20");
    return jsonOk(await listSecurityEvents({ page: p, pageSize, type: request.nextUrl.searchParams.get("type") ?? undefined, actorId: auth.user.id }), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
