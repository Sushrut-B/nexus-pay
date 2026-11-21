import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { z } from "zod";
import { getSupportPreferences, updateSupportPreferences } from "@/lib/support/support-operations";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  caseUpdates: z.boolean().optional(),
  messages: z.boolean().optional(),
  resolutionNotices: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    return jsonOk(await getSupportPreferences(auth.user.id), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 20, 60000);
    const input = schema.parse(await readJsonBody(request));
    return jsonOk(await updateSupportPreferences(auth.user.id, input), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
