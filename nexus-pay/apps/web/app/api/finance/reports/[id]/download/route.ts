import type { NextRequest } from "next/server";
import { getRequestId, handleRouteError } from "@/lib/api/response";
import { requireMerchantUser } from "@/lib/merchant/api-guard";
import { downloadReport } from "@/lib/finance-intelligence/report-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireMerchantUser();
    const { id } = await context.params;
    const { buffer, fileName, contentType } = await downloadReport(user.id, id);
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
