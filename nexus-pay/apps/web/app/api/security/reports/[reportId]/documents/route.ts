import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { uploadReportDocument } from "@/lib/fraud/report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow(`fraud-report-doc:${auth.user.id}`, 10, 60_000);
    const { reportId } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "A document file is required.");
    return jsonOk(await uploadReportDocument(auth.user.id, reportId, {
      bytes: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
    }), requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
