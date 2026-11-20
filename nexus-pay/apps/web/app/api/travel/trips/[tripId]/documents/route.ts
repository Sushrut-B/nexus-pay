import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { uploadDocument } from "@/lib/travel/document-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ tripId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("travel-write:" + auth.user.id, 20, 60000);
    const { tripId } = await context.params;
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "A document file is required.");
    return jsonOk(await uploadDocument(auth.user.id, { bytes: Buffer.from(await file.arrayBuffer()), fileName: file.name, contentType: file.type || "application/octet-stream" }, { tripId, kind: String(form.get("kind") ?? "OTHER") }), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
