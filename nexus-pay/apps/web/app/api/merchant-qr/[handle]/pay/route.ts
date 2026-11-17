import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { resolveMerchantQr } from "@/lib/merchant/payment-link-service";
import { processMerchantPayment } from "@/lib/merchant/payment-service";
import { checkoutConfirmSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(request: NextRequest, context: { params: Promise<{ handle: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(`merchant-qr-pay:${getClientIp(request)}`, 12, 60_000);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to pay this merchant.");
    const { handle } = await context.params;
    const merchant = await resolveMerchantQr(handle);
    if (merchant.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "This merchant is not accepting payments.");
    const body = (await readJsonBody(request)) as { clientRequestId?: string; amountMinor?: number };
    const input = checkoutConfirmSchema.parse({ clientRequestId: body.clientRequestId });
    const amountMinor = body.amountMinor;
    if (!Number.isSafeInteger(amountMinor) || (amountMinor ?? 0) <= 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "Enter a valid amount.");
    }
    const payment = await processMerchantPayment({
      customerUserId: auth.user.id,
      merchantId: merchant.id,
      amountMinor: amountMinor!,
      clientRequestId: input.clientRequestId,
      description: `QR payment to ${merchant.displayName}`,
      source: "QR",
    });
    return jsonOk({ payment, receipt: `/transactions/${encodeURIComponent(payment.paymentRef)}` }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
