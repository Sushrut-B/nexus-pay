import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { dataExportRequestSchema } from "@nexus/validation";
import { listExports, requestDataExport } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-exports:" + auth.user.id, 30, 60000);
    return jsonOk({ exports: await listExports(auth.user.id) }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-exports-write:" + auth.user.id, 5, 60 * 60_000);
    const input = dataExportRequestSchema.parse(await readJsonBody(request));
    return jsonOk(await requestDataExport(auth.user.id, input), requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
