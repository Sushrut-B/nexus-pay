import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { supportMessageSchema } from "@nexus/validation";
import { sendMessage } from "@/lib/support/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 20, 60000);
    const { id } = await context.params;
    const input = supportMessageSchema.parse(await readJsonBody(request));
    return jsonOk({ id: await sendMessage(auth.user.id, id, input) }, requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
