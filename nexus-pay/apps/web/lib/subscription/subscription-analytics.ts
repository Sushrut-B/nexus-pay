import { prisma } from "@nexus/database";
import type { PricingSnapshot, SubscriptionAnalytics } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { normalizeToMonthly } from "@/lib/subscription/billing-calendar";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";

const DEFINITIONS: Record<string, string> = {
  mrrMinor: "Sum of each active/past-due subscription's current recurring amount normalized to a monthly equivalent, in paise. Trials and setup fees excluded.",
  arrMinor: "MRR × 12. A normalized run-rate, not contracted annual revenue.",
  activeSubscriptions: "Subscriptions currently in ACTIVE status. Trials are reported separately.",
  newSubscriptions: "Subscriptions created in the selected range, regardless of status.",
  cancelledSubscriptions: "Subscriptions with a cancellation timestamp in the selected range.",
  churnRate: "cancelledSubscriptions ÷ (activeSubscriptions + cancelledSubscriptions) × 100 for the range; null when the denominator is zero.",
  averageSubscriptionValueMinor: "MRR ÷ activeSubscriptions, rounded; null when there are no active subscriptions.",
  trialConversionRate: "Subscriptions activated after a trial ÷ trials that ended in the range × 100; null when no trials ended.",
  failedRenewalRate: "Failed billing occurrences ÷ all billing occurrences in the range × 100; null when there were none.",
  recoveryRate: "Occurrences settled after at least one failed attempt ÷ all failed occurrences × 100; null when there were none.",
  outstandingInvoiceMinor: "Sum of OPEN and PAST_DUE invoice totals at the time of the query.",
  collectedRenewalMinor: "Sum of SETTLED occurrences with occurrenceNumber > 1 in the range (renewals only, not initial payments).",
};

export function resolveSubscriptionRange(range: string, from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  if (from && to) {
    return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T23:59:59.999Z`) };
  }
  const days = range === "today" ? 1 : range === "week" ? 7 : range === "90days" ? 90 : 30;
  const result = new Date(now);
  if (range === "today") result.setUTCHours(0, 0, 0, 0);
  else result.setUTCDate(result.getUTCDate() - days);
  return { from: result, to: now };
}

export async function getSubscriptionAnalytics(
  userId: string,
  range: string,
  from?: string,
  to?: string,
): Promise<SubscriptionAnalytics> {
  const merchant = await requireMerchantForUser(userId);
  const window = resolveSubscriptionRange(range, from, to);

  const [allSubscriptions, created, cancelled, occurrences, outstanding] = await Promise.all([
    prisma.subscription.findMany({
      where: { merchantId: merchant.id, status: { in: ["ACTIVE", "PAST_DUE"] } },
    }),
    prisma.subscription.findMany({
      where: { merchantId: merchant.id, createdAt: { gte: window.from, lte: window.to } },
    }),
    prisma.subscription.findMany({
      where: { merchantId: merchant.id, cancelledAt: { gte: window.from, lte: window.to } },
    }),
    prisma.billingOccurrence.findMany({
      where: { merchantId: merchant.id, createdAt: { gte: window.from, lte: window.to } },
    }),
    prisma.invoice.aggregate({
      where: { merchantId: merchant.id, status: { in: ["OPEN", "PAST_DUE"] } },
      _sum: { totalMinor: true },
    }),
  ]);

  const mrrMinor = allSubscriptions.reduce((sum, subscription) => {
    const snapshot = subscription.pricingSnapshot as unknown as PricingSnapshot;
    return sum + normalizeToMonthly(snapshot.amountMinor, snapshot.frequency, snapshot.intervalCount);
  }, 0);
  const active = allSubscriptions.filter((subscription) => subscription.status === "ACTIVE").length;
  const churnDenominator = active + cancelled.length;
  const failed = occurrences.filter((occurrence) => occurrence.status === "FAILED" || occurrence.status === "DEAD_LETTER").length;
  const recovered = occurrences.filter(
    (occurrence) => occurrence.status === "SETTLED" && occurrence.attemptCount > 1,
  ).length;
  const trialEnded = await prisma.subscription.count({
    where: {
      merchantId: merchant.id,
      trialEndDate: { gte: window.from, lte: window.to },
    },
  });
  const trialConverted = await prisma.subscription.count({
    where: {
      merchantId: merchant.id,
      trialEndDate: { gte: window.from, lte: window.to },
      status: { in: ["ACTIVE", "PAST_DUE", "CANCELLATION_SCHEDULED"] },
    },
  });

  return {
    range: { from: window.from.toISOString(), to: window.to.toISOString() },
    mrrMinor,
    arrMinor: mrrMinor * 12,
    activeSubscriptions: active,
    newSubscriptions: created.length,
    cancelledSubscriptions: cancelled.length,
    churnRate: churnDenominator === 0 ? null : Math.round((cancelled.length / churnDenominator) * 1000) / 10,
    averageSubscriptionValueMinor: active === 0 ? 0 : Math.round(mrrMinor / active),
    trialConversionRate: trialEnded === 0 ? null : Math.round((trialConverted / trialEnded) * 1000) / 10,
    failedRenewalRate: occurrences.length === 0 ? null : Math.round((failed / occurrences.length) * 1000) / 10,
    recoveryRate: failed === 0 ? null : Math.round((recovered / failed) * 1000) / 10,
    outstandingInvoiceMinor: outstanding._sum.totalMinor ?? 0,
    collectedRenewalMinor: occurrences
      .filter((occurrence) => occurrence.status === "SETTLED" && occurrence.occurrenceNumber > 1)
      .reduce((sum, occurrence) => sum + occurrence.amountMinor, 0),
    currency: "INR",
    definitions: DEFINITIONS,
  };
}

export async function getRecoveryDashboard(userId: string) {
  const merchant = await requireMerchantForUser(userId);
  const [failed, pastDueInvoices, atRisk, unresolved] = await Promise.all([
    prisma.billingOccurrence.count({ where: { merchantId: merchant.id, status: { in: ["FAILED", "DEAD_LETTER"] } } }),
    prisma.invoice.findMany({
      where: { merchantId: merchant.id, status: "PAST_DUE" },
      orderBy: { dueDate: "asc" },
      take: 50,
    }),
    prisma.subscription.count({ where: { merchantId: merchant.id, status: { in: ["PAST_DUE", "REQUIRES_CUSTOMER_ACTION"] } } }),
    prisma.billingOccurrence.count({ where: { merchantId: merchant.id, status: "RECONCILIATION_REQUIRED" } }),
  ]);
  return {
    failedRenewalCount: failed,
    outstandingInvoices: pastDueInvoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalMinor: invoice.totalMinor,
      dueDate: invoice.dueDate.toISOString(),
      customerUserId: invoice.customerUserId,
    })),
    subscriptionsAtRisk: atRisk,
    unresolvedOutcomes: unresolved,
  };
}

export async function requireSubscriptionMerchant(merchantId: string) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) throw new ApiError(404, "PAYMENT_ERROR", "Merchant not found.");
  return merchant;
}
