import type { NextRequest } from "next/server";
import { enforceRateLimitOrThrow, getClientIp } from "@/lib/api/rate-limit";
import { getRequestId, handleRouteError, jsonOk } from "@/lib/api/response";
import { getAuthenticatedUser } from "@/lib/auth/session";
import { resolvePublicPlan } from "@/lib/subscription/plan-service";
import { frequencyLabel } from "@/lib/subscription/billing-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const requestId = getRequestId(request);
  try {
    enforceRateLimitOrThrow(`subscribe-view:${getClientIp(request)}`, 60, 60_000);
    const { token } = await context.params;
    const plan = await resolvePublicPlan(token);
    const auth = await getAuthenticatedUser();
    const now = new Date();
    const firstBilling = plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 86_400_000)
      : now;
    const amountDueToday = plan.trialDays > 0
      ? 0
      : (plan.introPriceMinor ?? plan.amountMinor) + plan.setupFeeMinor;

    return jsonOk({
      merchant: {
        id: plan.merchant.id,
        displayName: plan.merchant.displayName,
        handle: plan.merchant.handle,
        logoUrl: plan.merchant.logoUrl,
        brandColor: plan.merchant.brandColor,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        imageUrl: plan.imageUrl,
        amountMinor: plan.amountMinor,
        setupFeeMinor: plan.setupFeeMinor,
        currency: plan.currency,
        frequency: plan.frequency,
        intervalCount: plan.intervalCount,
        trialDays: plan.trialDays,
        introPriceMinor: plan.introPriceMinor,
        introPeriods: plan.introPeriods,
        cancellationPolicy: plan.cancellationPolicy,
      },
      amountDueTodayMinor: amountDueToday,
      firstBillingDate: firstBilling.toISOString(),
      subsequentBilling: frequencyLabel(plan.frequency as never, plan.intervalCount),
      trialEndDate: plan.trialDays > 0 ? firstBilling.toISOString() : null,
      cancellationPolicy: plan.cancellationPolicy,
      signedIn: Boolean(auth),
      sandboxNotice: "Sandbox recurring billing. No bank mandate, UPI AutoPay or card-on-file is established. Each renewal is a separate Nexus Pay wallet settlement.",
    }, requestId);
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
