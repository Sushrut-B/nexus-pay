import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const items = await prisma.taxPaymentRecord.findMany({ where: { userId: auth.user.id }, orderBy: { paidAt: "desc" }, take: 100 }); return jsonOk({ items }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
