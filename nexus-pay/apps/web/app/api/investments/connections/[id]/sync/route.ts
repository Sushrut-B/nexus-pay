import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
import { enqueueInvestmentSync, getSyncStatus } from "@/lib/investments/sync-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const connection = await prisma.investmentConnection.findFirst({ where: { id, userId: auth.user.id } });
    if (!connection) throw new ApiError(404, "AUTHORIZATION_ERROR", "Connection not found.");
    await enqueueInvestmentSync(id, "INCREMENTAL_SYNC"); return jsonOk({ id, status: await getSyncStatus(auth.user.id, id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
