import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { getDocumentLink } from "@/lib/investments/discovery-service";
import { downloadDocument } from "@/lib/investments/document-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {

    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("investments:" + auth.user.id, 25, 60000);
    const { id } = await context.params;
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const expiresAt = Number(request.nextUrl.searchParams.get("expiresAt") ?? "0");
    if (token && expiresAt) {
      const result = await downloadDocument(auth.user.id, id, token, expiresAt);
      return new Response(new Uint8Array(result.buffer), { status: 200, headers: { "Content-Type": result.contentType, "Content-Disposition": "attachment; filename=" + result.fileName, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
    }
    const link = await getDocumentLink(auth.user.id, id);
    return new Response(null, { status: 302, headers: { Location: "/api/investments/documents/" + encodeURIComponent(id) + "/download?token=" + link.token + "&expiresAt=" + link.expiresAt } });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
