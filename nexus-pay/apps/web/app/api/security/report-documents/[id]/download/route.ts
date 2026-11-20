import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/response";
import { downloadReportDocument, getReportDownloadLink } from "@/lib/fraud/report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    const { id } = await context.params;
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const expiresAt = Number(request.nextUrl.searchParams.get("expiresAt") ?? "0");
    if (token && expiresAt) {
      const { buffer, contentType, fileName } = await downloadReportDocument(auth.user.id, id, token, expiresAt);
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId,
        },
      });
    }
    const link = await getReportDownloadLink(auth.user.id, id);
    return new Response(null, {
      status: 302,
      headers: { Location: `/api/security/report-documents/${encodeURIComponent(id)}/download?token=${link.token}&expiresAt=${link.expiresAt}` },
    });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
