import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError } from "@/lib/api/response";
import { resolvePublicLink } from "@/lib/merchant/payment-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dynamic merchant QR: encodes a specific payment link, so the payable amount
 * is fixed server-side and cannot be changed by the customer.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`merchant-qr-link:${getClientIp(request)}`, 60, 60_000);
    const { token } = await context.params;
    const link = await resolvePublicLink(token);
    if (link.merchant.status !== "ACTIVE") {
      throw new ApiError(409, "PAYMENT_ERROR", "This merchant is not accepting payments.");
    }
    if (link.status !== "ACTIVE") {
      throw new ApiError(409, "PAYMENT_ERROR", "This payment link is not active.");
    }
    if (link.expiresAt && link.expiresAt <= new Date()) {
      throw new ApiError(409, "PAYMENT_ERROR", "This payment link has expired.");
    }
    if (link.maxPayments !== null && link.paymentCount >= link.maxPayments) {
      throw new ApiError(409, "PAYMENT_ERROR", "This payment link has reached its payment limit.");
    }

    const checkoutUrl = new URL(`/pay-link/${encodeURIComponent(link.token)}`, request.nextUrl.origin).toString();
    const png = await QRCode.toBuffer(checkoutUrl, {
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
