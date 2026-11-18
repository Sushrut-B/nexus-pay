import { prisma } from "@nexus/database";
import type { SubscriptionIntelligenceView } from "@nexus/shared-types";
import { normalizeToMonthly } from "@/lib/subscription/billing-calendar";

export async function getSubscriptionIntelligence(userId: string): Promise<SubscriptionIntelligenceView> {
  const [subscriptions, failedOccurrences] = await Promise.all([
    prisma.subscription.findMany({
      where: { customerUserId: userId },
      orderBy: { nextBillingDate: "asc" },
    }),
    prisma.billingOccurrence.count({
      where: {
        subscription: { customerUserId: userId },
        status: { in: ["FAILED", "DEAD_LETTER"] },
      },
    }),
  ]);
  const now = new Date();
  const active = subscriptions.filter((subscription) => ["ACTIVE", "TRIALING"].includes(subscription.status));
  const monthly = active.reduce((sum, subscription) => {
    const snapshot = subscription.pricingSnapshot as { amountMinor?: number; frequency?: never; intervalCount?: number };
    const frequency = (subscription.frequency as "MONTHLY" | "WEEKLY" | "DAILY" | "QUARTERLY" | "YEARLY" | "CUSTOM") ?? "MONTHLY";
    return sum + normalizeToMonthly(snapshot.amountMinor ?? 0, frequency, subscription.intervalCount);
  }, 0);
  const settledRenewals = await prisma.billingOccurrence.aggregate({
    where: {
      subscription: { customerUserId: userId },
      status: "SETTLED",
      occurrenceNumber: { gt: 1 },
    },
    _sum: { amountMinor: true },
  });

  return {
    activeCount: active.filter((s) => s.status === "ACTIVE").length,
    pausedCount: subscriptions.filter((s) => s.status === "PAUSED").length,
    failedCount: failedOccurrences,
    upcomingCount: active.filter((s) => s.nextBillingDate && s.nextBillingDate >= now).length,
    monthlyCommitmentMinor: monthly,
    annualCommitmentMinor: monthly * 12,
    upcoming: active
      .filter((subscription) => subscription.nextBillingDate)
      .slice(0, 20)
      .map((subscription) => ({
        id: subscription.id,
        planName: subscription.planId,
        amountMinor: (subscription.pricingSnapshot as { amountMinor?: number }).amountMinor ?? 0,
        nextBillingDate: subscription.nextBillingDate!.toISOString(),
        status: subscription.status,
      })),
    settledRenewalsMinor: settledRenewals._sum.amountMinor ?? 0,
    currency: "INR",
    notice: "Commitments are estimates from active plans. Settled renewals are verified payments; future billing is scheduled, not collected.",
  };
}
