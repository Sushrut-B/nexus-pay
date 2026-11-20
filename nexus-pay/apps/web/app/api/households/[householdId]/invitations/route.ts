import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { inviteMember } from "@/lib/billing/household-service";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ householdId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("billing-write:" + auth.user.id, 20, 60000);
    const { householdId } = await context.params;
    const body = await readJsonBody(request);
    const input = z.object({ userId: z.string().min(2).max(80), role: z.enum(["ADMIN","MEMBER","VIEWER"]).default("MEMBER") }).parse(body);
    return jsonOk(await inviteMember(auth.user.id, householdId, input.userId, input.role), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

