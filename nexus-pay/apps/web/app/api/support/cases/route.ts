import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { supportCaseCreateSchema } from "@nexus/validation";
import { createCase, listCases } from "@/lib/support/case-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 30, 60000);
    const q = request.nextUrl.searchParams;
    return jsonOk({ cases: await listCases(auth.user.id, {
      status: q.get("status") ?? undefined,
      category: q.get("category") ?? undefined,
      limit: Number(q.get("limit") ?? 25),
      offset: Number(q.get("offset") ?? 0),
    }) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 10, 60000);
    const input = supportCaseCreateSchema.parse(await readJsonBody(request));
    return jsonOk(await createCase(auth.user.id, input), requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
