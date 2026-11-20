import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { addBookingToTrip } from "@/lib/travel/trip-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ tripId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("travel-write:" + auth.user.id, 20, 60000);
    const { tripId } = await context.params;
    const body = await readJsonBody(request) as { bookingId: string; title: string; startAt: string; endAt?: string; startTimeZone?: string; endTimeZone?: string; location?: string };
    if (!body.bookingId || !body.title || !body.startAt) throw new ApiError(400, "VALIDATION_ERROR", "bookingId, title and startAt are required.");
    return jsonOk(await addBookingToTrip(auth.user.id, tripId, body.bookingId, body), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
