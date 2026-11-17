import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ignoreSuggestion } from "@/lib/finance/recurring-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    await ignoreSuggestion(auth.user.id, id);
    return jsonOk({ ignored: true }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
