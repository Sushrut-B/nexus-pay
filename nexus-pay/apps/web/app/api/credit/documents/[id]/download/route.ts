import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { downloadDocument } from "@/lib/credit/document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const token = request.nextUrl.searchParams.get("token") ?? "";
    const expiresAt = Number(request.nextUrl.searchParams.get("expiresAt") ?? "0");
    const { buffer, contentType, fileName } = await downloadDocument(user.id, id, token, expiresAt);
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
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
