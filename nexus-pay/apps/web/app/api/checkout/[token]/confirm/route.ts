import type { NextRequest } from "next/server";

import { prisma } from "@nexus/database";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { resolvePublicLink } from "@/lib/merchant/payment-link-service";
import { processMerchantPayment } from "@/lib/merchant/payment-service";
import { validatePromoCode, consumePromoCode } from "@/lib/rewards/promo-service";
import { releaseReservation } from "@/lib/rewards/campaign-service";
import { checkoutConfirmSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(`checkout-confirm:${getClientIp(request)}`, 12, 60_000);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to pay.");
    const { token } = await context.params;
    const input = checkoutConfirmSchema.parse(await readJsonBody(request));

    const link = await resolvePublicLink(token);
    if (link.merchant.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "Merchant is not accepting payments.");
    if (link.status !== "ACTIVE") throw new ApiError(409, "PAYMENT_ERROR", "Payment link is not active.");
    if (link.expiresAt && link.expiresAt <= new Date()) throw new ApiError(409, "PAYMENT_ERROR", "Payment link expired.");

    // Create or reuse the checkout session with a unique client request id.
    let session = await prisma.merchantCheckoutSession.findUnique({
      where: { clientRequestId: input.clientRequestId },
    });
    if (!session) {
      session = await prisma.merchantCheckoutSession.create({
        data: {
          merchantId: link.merchantId,
          orderId: link.orderId,
          token: `${link.token}:${input.clientRequestId}`,
          clientRequestId: input.clientRequestId,
          status: "PROCESSING",
          expiresAt: link.expiresAt ?? new Date(Date.now() + 30 * 60_000),
        },
      });
    } else if (session.merchantId !== link.merchantId || session.token !== `${link.token}:${input.clientRequestId}`) {
      throw new ApiError(409, "PAYMENT_ERROR", "This checkout reference belongs to another request.");
    }

    const existing = await prisma.merchantPayment.findFirst({
      where: { merchantId: link.merchantId, paymentIntentId: { in: [input.clientRequestId] } },
    });
    if (existing) {
      await prisma.merchantCheckoutSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      return jsonOk({ payment: existing, receipt: `/transactions/${encodeURIComponent(existing.paymentRef)}` }, requestId);
    }

    let promo: { campaignId: string; discountMinor: number; reservationId: string } | null = null;
    if (input.promoCode) {
      if (!input.promoOrderId) throw new ApiError(400, "VALIDATION_ERROR", "A promo order reference is required.");
      const validated = await validatePromoCode(auth.user.id, {
        code: input.promoCode,
        amountMinor: link.amountMinor,
        orderId: input.promoOrderId,
        merchantId: link.merchantId,
      });
      if (!validated.valid || !validated.campaignId || !validated.reservationId) {
        if (validated.reservationId) await releaseReservation(prisma, validated.reservationId);
        throw new ApiError(400, "VALIDATION_ERROR", validated.reason ?? "This promo code cannot be applied.");
      }
      promo = {
        campaignId: validated.campaignId,
        discountMinor: validated.discountMinor,
        reservationId: validated.reservationId,
      };
    }
    const payableMinor = promo ? link.amountMinor - promo.discountMinor : link.amountMinor;

    let payment;
    try {
      payment = await processMerchantPayment({
        customerUserId: auth.user.id,
        merchantId: link.merchantId,
        amountMinor: payableMinor,
        clientRequestId: input.clientRequestId,
        description: link.title,
        source: "PAYMENT_LINK",
        orderId: link.orderId ?? undefined,
        linkId: link.id,
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) {
        if (promo) await releaseReservation(prisma, promo.reservationId);
        throw error;
      }
      const recovered = await prisma.merchantPayment.findFirst({
        where: { merchantId: link.merchantId, paymentIntentId: input.clientRequestId },
      });
      if (!recovered) {
        if (promo) await releaseReservation(prisma, promo.reservationId);
        throw error;
      }
      payment = recovered;
    }

    if (promo && payment.paymentRef) {
      await consumePromoCode({
        campaignId: promo.campaignId,
        userId: auth.user.id,
        orderId: input.promoOrderId!,
        reservationId: promo.reservationId,
        discountMinor: promo.discountMinor,
        paymentRef: payment.paymentRef,
      });
    }

    await prisma.merchantCheckoutSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return jsonOk({
      payment,
      receipt: `/transactions/${encodeURIComponent(payment.paymentRef)}`,
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}

