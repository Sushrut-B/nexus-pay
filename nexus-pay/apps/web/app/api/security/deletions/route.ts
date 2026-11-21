import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { dataDeletionRequestSchemaV2 } from "@nexus/validation";
import { RETENTION_NOTICE, listDeletions, requestDataDeletion } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-deletions:" + auth.user.id, 30, 60000);
    return jsonOk({ requests: await listDeletions(auth.user.id), retentionNotice: RETENTION_NOTICE }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-deletions-write:" + auth.user.id, 3, 60 * 60_000);
    const input = dataDeletionRequestSchemaV2.parse(await readJsonBody(request));
    return jsonOk(await requestDataDeletion(auth.user.id, input), requestId, 201);
  } catch (error) { return handleRouteError(error, requestId); }
}
