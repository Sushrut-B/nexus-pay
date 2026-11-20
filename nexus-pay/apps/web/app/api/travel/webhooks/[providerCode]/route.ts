import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { receiveTravelWebhook } from "@/lib/travel/travel-webhook-service";
import { travelWebhookSchema } from "@nexus/validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ providerCode: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("travel-write:" + auth.user.id, 20, 60000);
    const { providerCode } = await context.params;
    return jsonOk(await receiveTravelWebhook(providerCode, travelWebhookSchema.parse(await readJsonBody(request))), requestId, 202);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
