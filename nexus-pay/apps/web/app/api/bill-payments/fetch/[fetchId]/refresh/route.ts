import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { prisma } from "@nexus/database";
import { refreshSnapshot } from "@/lib/billing/bill-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ fetchId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("billing-write:" + auth.user.id, 20, 60000);
    const { fetchId } = await context.params;

    const fetch = await prisma.billFetchRequest.findFirst({ where: { id: fetchId, userId: auth.user.id }, include: { snapshots: { orderBy: { fetchedAt: "desc" }, take: 1 } } });
    if (!fetch?.snapshots[0]) throw new ApiError(404, "PAYMENT_ERROR", "No bill snapshot to refresh.");
    return jsonOk(await refreshSnapshot(auth.user.id, fetch.snapshots[0].id), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

