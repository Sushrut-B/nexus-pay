import type { NextRequest } from "next/server";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getCalendarEvents } from "@/lib/finance/calendar-service";
import { calendarQuerySchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const now = new Date();
    const defaults = {
      from: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
      to: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()).padStart(2, "0")}`,
    };
    const query = calendarQuerySchema.parse({
      from: request.nextUrl.searchParams.get("from") ?? defaults.from,
      to: request.nextUrl.searchParams.get("to") ?? defaults.to,
    });
    return jsonOk({ items: await getCalendarEvents(auth.user.id, query.from, query.to) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
