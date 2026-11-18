import { prisma } from "@nexus/database";
import type { AdminRewardsOverview, OfferSummary, ReconciliationView, RewardLedgerView, RewardSummary } from "@nexus/shared-types";
import type { RewardListQuery } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getOrCreateRewardAccount, paginationMeta } from "@/lib/rewards/reward-core";
import { requireMerchantForUser } from "@/lib/merchant/merchant-service";
import { getMembershipView } from "@/lib/rewards/tier-service";

function campaignTypeLabel(type: string): string {
  return type.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export async function getRewardSummary(userId: string): Promise<RewardSummary> {
  const account = await getOrCreateRewardAccount(userId);
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const [expiring, cashback, activeOffers, membership] = await Promise.all([
    prisma.rewardLedgerEntry.aggregate({
      where: { userId, expiresAt: { gt: now, lte: soon } },
      _sum: { points: true },
    }),
    prisma.cashbackEntitlement.groupBy({ by: ["status"], where: { userId }, _sum: { amountMinor: true } }),
    prisma.rewardCampaign.count({
      where: { status: "ACTIVE", startAt: { lte: now }, endAt: { gte: now } },
    }),
    getMembershipView(userId),
  ]);
  const sumStatus = (statuses: string[]) =>
    cashback.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + (row._sum.amountMinor ?? 0), 0);
  return {
    availablePoints: account.availablePoints,
    lifetimeEarnedPoints: account.lifetimeEarnedPoints,
    lifetimeRedeemedPoints: account.lifetimeRedeemedPoints,
    pendingPoints: account.pendingPoints,
    expiringSoonPoints: expiring._sum.points ?? 0,
    cashbackEarnedMinor: sumStatus(["CREDITED", "PENDING_CREDIT", "ELIGIBLE", "PROCESSING"]),
    cashbackPendingMinor: sumStatus(["ELIGIBLE", "PENDING_CREDIT", "PROCESSING", "ELIGIBILITY_PENDING"]),
    cashbackCreditedMinor: sumStatus(["CREDITED"]),
    activeOffers: activeOffers,
    membership: {
      tierName: membership.tierName,
      rank: membership.rank,
      nextTier: membership.nextTier,
      progressBps: membership.progressBps,
    },
    currency: "INR",
    notice: "Reward points are non-cash loyalty units with no INR value. Cashback is a separate sandbox promotional wallet credit.",
  };
}

export async function getRewardLedger(userId: string, query: RewardListQuery) {
  const where = {
    userId,
    ...(query.type ? { type: query.type as never } : {}),
    ...(query.merchantId ? { merchantId: query.merchantId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
            ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.rewardLedgerEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.rewardLedgerEntry.count({ where }),
  ]);
  const items: RewardLedgerView[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    points: row.points,
    balanceAfter: row.balanceAfter,
    description: row.description,
    merchantName: null,
    transactionRef: row.transactionRef,
    status: row.points >= 0 ? "COMPLETED" : "DEBITED",
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
  return { items, ...paginationMeta(total, query.page, query.pageSize) };
}

export async function getOffers(): Promise<OfferSummary[]> {
  const now = new Date();
  const campaigns = await prisma.rewardCampaign.findMany({
    where: { status: "ACTIVE", startAt: { lte: now }, endAt: { gte: now } },
    orderBy: { endAt: "asc" },
    take: 100,
  });
  const budgets = await prisma.campaignBudget.findMany({
    where: { campaignId: { in: campaigns.map((campaign) => campaign.id) } },
  });
  const budgetMap = new Map(budgets.map((budget) => [budget.campaignId, budget]));
  return campaigns.map((campaign) => {
    const budget = budgetMap.get(campaign.id);
    const remaining = budget ? budget.allocatedMinor - budget.reservedMinor - budget.consumedMinor : 0;
    const eligible = remaining > 0 && !campaign.customerSegments.includes("EXCLUDED");
    return {
      id: campaign.id,
      merchantId: campaign.merchantId,
      merchantName: null,
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      typeLabel: campaignTypeLabel(campaign.type),
      minSpendMinor: campaign.minSpendMinor,
      maxRewardMinor: campaign.maxRewardMinor,
      pointsPerMinor: campaign.pointsPerMinor,
      cashbackBps: campaign.cashbackBps,
      startAt: campaign.startAt.toISOString(),
      endAt: campaign.endAt.toISOString(),
      eligible,
      eligibilityReason: eligible ? null : "Budget exhausted or not eligible",
      remainingBudgetMinor: Math.max(0, remaining),
      promoCode: campaign.promoCode,
    };
  });
}

export async function getOffer(id: string): Promise<OfferSummary> {
  const offers = await getOffers();
  const offer = offers.find((item) => item.id === id);
  if (!offer) throw new ApiError(404, "PAYMENT_ERROR", "Offer not found or unavailable.");
  return offer;
}

export async function getAdminOverview(): Promise<AdminRewardsOverview> {
  const [issued, redeemed, expired, cashbackGroups, campaigns, redemptions, referralRewards, riskEvents] = await Promise.all([
    prisma.rewardLedgerEntry.aggregate({ where: { type: "EARN" }, _sum: { points: true } }),
    prisma.rewardLedgerEntry.aggregate({ where: { type: "REDEEM" }, _sum: { points: true } }),
    prisma.rewardLedgerEntry.aggregate({ where: { type: "EXPIRE" }, _sum: { points: true } }),
    prisma.cashbackEntitlement.groupBy({ by: ["status"], _sum: { amountMinor: true }, _count: { _all: true } }),
    prisma.rewardCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.rewardRedemption.count(),
    prisma.referralReward.count({ where: { status: "ISSUED" } }),
    prisma.rewardRiskEvent.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW", "ACTION_REQUIRED"] } } }),
  ]);
  const statusSum = (statuses: string[]) =>
    cashbackGroups.filter((group) => statuses.includes(group.status)).reduce((sum, g) => sum + (g._sum.amountMinor ?? 0), 0);
  const campaignCount = (status: string) => campaigns.find((c) => c.status === status)?._count._all ?? 0;
  const account = await prisma.rewardAccount.aggregate({ _sum: { availablePoints: true } });
  return {
    points: {
      issued: issued._sum.points ?? 0,
      redeemed: Math.abs(redeemed._sum.points ?? 0),
      expired: Math.abs(expired._sum.points ?? 0),
      outstanding: account._sum.availablePoints ?? 0,
    },
    cashback: {
      entitlements: cashbackGroups.reduce((sum, g) => sum + g._count._all, 0),
      creditedMinor: statusSum(["CREDITED"]),
      pendingMinor: statusSum(["ELIGIBLE", "PENDING_CREDIT", "PROCESSING", "ELIGIBILITY_PENDING"]),
      failed: cashbackGroups.filter((g) => g.status === "FAILED").reduce((sum, g) => sum + g._count._all, 0),
    },
    campaigns: {
      active: campaignCount("ACTIVE"),
      exhausted: campaignCount("EXHAUSTED"),
      total: campaigns.reduce((sum, c) => sum + c._count._all, 0),
    },
    redemptions,
    referralRewardsIssued: referralRewards,
    riskEvents,
    currency: "INR",
    notice: "Points are non-cash loyalty units. Cashback values are sandbox wallet credits settled through Raftline.",
  };
}

export async function getReconciliation(): Promise<ReconciliationView> {
  const [accountSum, ledgerSum, budgets, outstandingCashback, reservations, unrewarded] = await Promise.all([
    prisma.rewardAccount.aggregate({ _sum: { availablePoints: true } }),
    prisma.rewardLedgerEntry.aggregate({ _sum: { points: true } }),
    prisma.campaignBudget.findMany(),
    prisma.cashbackEntitlement.count({ where: { status: { in: ["ELIGIBLE", "PENDING_CREDIT", "PROCESSING", "REQUIRES_RECONCILIATION"] } } }),
    prisma.campaignBudgetReservation.count({ where: { status: "HELD" } }),
    prisma.referralAttribution.count({ where: { status: "QUALIFIED" } }),
  ]);
  const ledgerBalance = ledgerSum._sum.points ?? 0;
  const computed = accountSum._sum.availablePoints ?? 0;
  const discrepancies: string[] = [];
  if (ledgerBalance !== computed) discrepancies.push("Points ledger does not match account balances");
  return {
    pointsLedgerBalance: ledgerBalance,
    computedBalance: computed,
    cashbackReservedMinor: budgets.reduce((sum, b) => sum + b.reservedMinor, 0),
    cashbackConsumedMinor: budgets.reduce((sum, b) => sum + b.consumedMinor, 0),
    pendingEntitlements: outstandingCashback,
    openReservations: reservations,
    referralQualifiedUnrewarded: unrewarded,
    discrepancies,
    currency: "INR",
  };
}

export async function getMerchantRewardsAnalytics(userId: string) {
  const merchant = await requireMerchantForUser(userId);
  const campaigns = await prisma.rewardCampaign.findMany({ where: { merchantId: merchant.id } });
  const catalogueIds = await prisma.rewardCatalogueItem.findMany({
    where: { merchantId: merchant.id },
    select: { id: true },
  });
  const [redemptions, cashback] = await Promise.all([
    prisma.rewardRedemption.count({
      where: { catalogueItemId: { in: catalogueIds.map((item) => item.id) } },
    }),
    prisma.cashbackEntitlement.aggregate({
      where: { campaignId: { in: campaigns.map((campaign) => campaign.id) }, status: "CREDITED" },
      _sum: { amountMinor: true },
    }),
  ]);
  return {
    campaigns: campaigns.length,
    activeCampaigns: campaigns.filter((c) => c.status === "ACTIVE").length,
    redemptions,
    cashbackCreditedMinor: cashback._sum.amountMinor ?? 0,
    budgetMinor: campaigns.reduce((sum, c) => sum + c.budgetMinor, 0),
    consumedMinor: campaigns.reduce((sum, c) => sum + c.consumedMinor, 0),
    currency: "INR",
  };
}

