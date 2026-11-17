import type { NextRequest } from "next/server";

import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { resolvePublicLink } from "@/lib/merchant/payment-link-service";
import { getAuthenticatedUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`checkout-view:${getClientIp(request)}`, 60, 60_000, "Too many checkout requests.");
    const { token } = await context.params;
    const link = await resolvePublicLink(token);
    const now = new Date();
    if (link.merchant.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "This merchant is not accepting payments.");
    if (!["ACTIVE"].includes(link.status)) throw new ApiError(409, "PAYMENT_ERROR", "This payment link is no longer active.");
    if (link.expiresAt && link.expiresAt <= now) throw new ApiError(409, "PAYMENT_ERROR", "This payment link has expired.");
    if (link.maxPayments !== null && link.paymentCount >= link.maxPayments) {
      throw new ApiError(409, "PAYMENT_ERROR", "This payment link has reached its payment limit.");
    }

    const auth = await getAuthenticatedUser();
    return jsonOk({
      merchant: {
        id: link.merchant.id,
        displayName: link.merchant.displayName,
        handle: link.merchant.handle,
        logoUrl: link.merchant.logoUrl,
        brandColor: link.merchant.brandColor,
        status: "SANDBOX ACTIVE",
      },
      title: link.title,
      description: link.description,
      amountMinor: link.amountMinor,
      currency: link.currency,
      order: link.orderId ? { id: link.orderId } : null,
      signedIn: Boolean(auth),
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

