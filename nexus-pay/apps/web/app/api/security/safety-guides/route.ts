import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { SAFETY_GUIDES } from "@/lib/fraud/safety-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");

    return jsonOk({ items: SAFETY_GUIDES }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

