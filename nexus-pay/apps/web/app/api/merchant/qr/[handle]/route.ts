import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { prisma } from "@nexus/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`merchant-qr:${getClientIp(request)}`, 60, 60_000);
    const { handle } = await context.params;
    const merchant = await prisma.merchant.findUnique({ where: { handle } });
    if (!merchant || merchant.status !== "ACTIVE") {
      throw new ApiError(404, "PAYMENT_ERROR", "This merchant QR is not available.");
    }
    const url = new URL(`/merchant-qr/${encodeURIComponent(handle)}`, request.nextUrl.origin).toString();
    const png = await QRCode.toBuffer(url, {
      type: "png",
      width: 640,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, max-age=0",
        "X-Request-Id": requestId,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
