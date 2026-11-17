import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listNotifications } from "@/lib/social/notification-service";
import { notificationListQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const query = notificationListQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    return jsonOk(await listNotifications(auth.user.id, query), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
