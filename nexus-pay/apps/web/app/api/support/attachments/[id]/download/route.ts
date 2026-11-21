import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { downloadEvidence } from "@/lib/support/evidence-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
    enforceRateLimitOrThrow("support:" + auth.user.id, 30, 60000);
    const { id } = await context.params;
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const expiresAt = request.nextUrl.searchParams.get("expiresAt") ?? "";
    const evidence = await downloadEvidence(auth.user.id, id, token, expiresAt);
    return new Response(new Uint8Array(evidence.bytes), {
      status: 200,
      headers: {
        "Content-Type": evidence.contentType,
        "Content-Disposition": `attachment; filename="${evidence.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) { return handleRouteError(error, requestId); }
}
