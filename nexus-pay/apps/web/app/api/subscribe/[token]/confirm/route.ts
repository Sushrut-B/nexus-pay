import type { NextRequest } from "next/server";
import { assertMutationRequest } from "@/lib/api/csrf";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { readJsonBody } from "@/lib/api/request";
import { ApiError, getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { createNotification } from "@/lib/social/shared";
import { prisma } from "@nexus/database";
import { processBillingOccurrence } from "@/lib/subscription/billing-engine";
import { resolvePublicPlan } from "@/lib/subscription/plan-service";
import { createSubscriptionFromCheckout } from "@/lib/subscription/subscription-service";
import { subscriptionCheckoutConfirmSchema } from "@nexus/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    assertMutationRequest(request);
    enforceRateLimitOrThrow(`subscribe-confirm:${getClientIp(request)}`, 12, 60_000);
    const auth = await getAuthenticatedUser();
    if (!auth) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to subscribe.");
    const { token } = await context.params;
    const input = subscriptionCheckoutConfirmSchema.parse(await readJsonBody(request));
    const plan = await resolvePublicPlan(token);

    const { subscription, occurrenceId } = await createSubscriptionFromCheckout(
      auth.user.id,
      plan,
      input.clientRequestId,
    );

    await createNotification(prisma, {
      userId: auth.user.id,
      type: "SUBSCRIPTION_CREATED",
      title: "Subscription created",
      body: `Your ${plan.name} subscription is set up.`,
      data: { subscriptionId: subscription.id, planId: plan.id },
    });

    let payment: { paymentRef: string; status: string } | null = null;
    if (occurrenceId) {
      const outcome = await processBillingOccurrence(occurrenceId);
      if (outcome.outcome === "unresolved") {
        throw new ApiError(409, "RECONCILIATION_REQUIRED", "The initial payment outcome could not be confirmed. No further charge was attempted.");
      }
      if (outcome.outcome === "failed") {
        throw new ApiError(402, "PAYMENT_ERROR", "The initial payment could not be completed. No recurring charge was made.");
      }
      const occurrence = await prisma.billingOccurrence.findUniqueOrThrow({ where: { id: occurrenceId } });
      payment = { paymentRef: outcome.detail ?? occurrence.paymentRef ?? "", status: "SETTLED" };
    }

    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: plan.merchantId } });
    await createNotification(prisma, {
      userId: merchant.ownerUserId,
      type: "SUBSCRIPTION_CREATED",
      title: "New subscriber",
      body: `A customer subscribed to ${plan.name}.`,
      data: { subscriptionId: subscription.id },
    });

    const settled = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
      include: { plan: true },
    });
    const { toSubscriptionView } = await import("@/lib/subscription/subscription-core");

    return jsonOk({
      subscription: toSubscriptionView(settled),
      payment,
      receipt: payment?.paymentRef ? `/transactions/${encodeURIComponent(payment.paymentRef)}` : null,
      portal: `/subscriptions/${encodeURIComponent(subscription.id)}`,
    }, requestId, 201);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
