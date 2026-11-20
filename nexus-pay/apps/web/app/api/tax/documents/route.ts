import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { listDocuments, uploadDocument } from "@/lib/tax/tax-document-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    return jsonOk({ items: await listDocuments(auth.user.id, request.nextUrl.searchParams.get("financialYear") ?? undefined) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("tax:" + auth.user.id, 25, 60000);

    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "A file is required.");
    return jsonOk(await uploadDocument(auth.user.id, { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, contentType: file.type || "application/octet-stream" }, { financialYear: String(form.get("financialYear") ?? "2025-26"), kind: String(form.get("kind") ?? "OTHER") }), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
