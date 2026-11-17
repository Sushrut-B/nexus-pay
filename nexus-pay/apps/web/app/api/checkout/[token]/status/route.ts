import type { NextRequest } from "next/server";
import { prisma } from "@nexus/database";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { ApiError } from "@/lib/api/response";
import { resolvePublicLink } from "@/lib/merchant/payment-link-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`checkout-status:${getClientIp(request)}`, 60, 60_000);
    const { token } = await context.params;
    const clientRequestId = request.nextUrl.searchParams.get("clientRequestId");
    if (!clientRequestId) throw new ApiError(400, "VALIDATION_ERROR", "A checkout reference is required.");
    const session = await prisma.merchantCheckoutSession.findUnique({ where: { clientRequestId } });
    if (!session) throw new ApiError(404, "PAYMENT_ERROR", "Checkout session not found.");
    const link = await resolvePublicLink(token);
    if (session.merchantId !== link.merchantId) throw new ApiError(404, "AUTHORIZATION_ERROR", "Checkout session not found.");
    const payment = await prisma.merchantPayment.findFirst({
      where: { merchantId: link.merchantId, paymentIntentId: clientRequestId },
    });
    return jsonOk({ status: session.status, payment }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
