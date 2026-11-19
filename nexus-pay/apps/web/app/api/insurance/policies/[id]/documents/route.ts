import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { listDocuments, uploadDocument } from "@/lib/insurance/document-service";
import { insuranceDocumentUploadSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    return jsonOk({ items: await listDocuments(user.id, "POLICY", id) }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const user = await requireMerchantUser();
    enforceRateLimitOrThrow("insurance-document:" + user.id, 20, 60_000);
    const { id } = await context.params;
    const form = await request.formData();
    const input = insuranceDocumentUploadSchema.parse({ category: form.get("category") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "A document file is required.");
    return jsonOk(await uploadDocument(user.id, "POLICY", id, input, {
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
    }), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

