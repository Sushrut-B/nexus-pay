import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { downloadExport } from "@/lib/identity/privacy-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("security-export-download:" + auth.user.id, 30, 60000);
    const { id } = await context.params;
    const result = await downloadExport(
      auth.user.id, id,
      request.nextUrl.searchParams.get("token") ?? "",
      request.nextUrl.searchParams.get("expiresAt") ?? "",
    );
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${result.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return handleRouteError(error, requestId); }
}
