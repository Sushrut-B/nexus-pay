import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
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

    const row = await prisma.taxProfile.findUnique({ where: { userId: auth.user.id } }); return jsonOk(row ?? { userId: auth.user.id }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const body = await readJsonBody(request) as { resident?: boolean; ageCategory?: string; defaultRegime?: "OLD" | "NEW" };
    const data = { ...(body.resident !== undefined ? { resident: body.resident } : {}), ...(body.ageCategory ? { ageCategory: body.ageCategory } : {}), ...(body.defaultRegime ? { defaultRegime: body.defaultRegime } : {}) };
    const row = await prisma.taxProfile.upsert({ where: { userId: auth.user.id }, create: { userId: auth.user.id, ...data }, update: data }); return jsonOk(row, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
