import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { createSettlement, executeSettlement, listSettlements } from "@/lib/social/settlement-service";
import { settlementCreateSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { groupId } = await context.params;
    return jsonOk(await listSettlements(auth.user.id, groupId), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ groupId: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`settlement:${auth.user.id}`, 10, 60_000);
    const { groupId } = await context.params;
    const input = settlementCreateSchema.parse(await readJsonBody(request));
    const settlement = await createSettlement(auth.user.id, groupId, input);
    const confirmed = await executeSettlement(auth.user.id, settlement.id);
    return jsonOk(confirmed, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
