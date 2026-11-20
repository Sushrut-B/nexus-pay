import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { resolveReconciliation } from "@/lib/tax/tax-document-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const body = await readJsonBody(request) as { status: "CONFIRMED" | "RESOLVED"; note: string }; return jsonOk(await resolveReconciliation(auth.user.id, id, body.status, body.note), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
