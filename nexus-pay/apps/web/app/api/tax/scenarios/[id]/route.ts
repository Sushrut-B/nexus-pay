import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const row = await prisma.taxPlanningScenario.findFirst({ where: { id, userId: auth.user.id } }); if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Scenario not found.");
    const body = await readJsonBody(request) as { name?: string }; const updated = await prisma.taxPlanningScenario.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}) } }); return jsonOk(updated, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const row = await prisma.taxPlanningScenario.findFirst({ where: { id, userId: auth.user.id } }); if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Scenario not found.");
    await prisma.taxPlanningScenario.delete({ where: { id } }); return jsonOk({ id, deleted: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
