import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { privacyConsentSchema } from "@nexus/validation";
import { PRIVACY_PURPOSES } from "@nexus/shared-types";
import { listConsents, updateConsent, RETENTION_NOTICE } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-consents:" + auth.user.id, 30, 60000);
    return jsonOk({ purposes: PRIVACY_PURPOSES, consents: await listConsents(auth.user.id), retentionNotice: RETENTION_NOTICE }, requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-consents-write:" + auth.user.id, 20, 60000);
    const input = privacyConsentSchema.parse(await readJsonBody(request));
    return jsonOk(await updateConsent(auth.user.id, input), requestId);
  } catch (error) { return handleRouteError(error, requestId); }
}
