import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { categorizeTransaction } from "@/lib/finance/category-service";
import { categorizeSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    const body = (await readJsonBody(request)) as Record<string, unknown>;
    const input = categorizeSchema.parse({ ...body, paymentRef: id });
    return jsonOk(await categorizeTransaction(auth.user.id, input), requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
