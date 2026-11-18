import { prisma } from "@nexus/database";
import type { MembershipView } from "@nexus/shared-types";
import { notifyOnce } from "@/lib/rewards/reward-core";

const DEFAULT_TIERS = [
  { name: "STANDARD", rank: 1, minSpendMinor: 0, minTransactions: 0, minLifetimePoints: 0, pointsMultiplierBps: 10000, benefits: ["Standard offers"] },
  { name: "SILVER", rank: 2, minSpendMinor: 500_000, minTransactions: 5, minLifetimePoints: 500, pointsMultiplierBps: 11000, benefits: ["Silver offers", "10% bonus points"] },
  { name: "GOLD", rank: 3, minSpendMinor: 2_000_000, minTransactions: 15, minLifetimePoints: 2000, pointsMultiplierBps: 12500, benefits: ["Gold offers", "25% bonus points"] },
  { name: "PLATINUM", rank: 4, minSpendMinor: 10_000_000, minTransactions: 50, minLifetimePoints: 10000, pointsMultiplierBps: 15000, benefits: ["Platinum offers", "50% bonus points"] },
] as const;

export async function ensureDefaultTiers(): Promise<void> {
  for (const tier of DEFAULT_TIERS) {
    await prisma.loyaltyTier.upsert({
      where: { name: tier.name },
      create: { ...tier, benefits: [...tier.benefits] as object },
      update: {},
    });
  }
}

/** Evaluate all user tiers from settled merchant spend in the qualification window. */
export async function runTierEvaluation(limit = 500): Promise<{ evaluated: number; changes: number }> {
  await ensureDefaultTiers();
  const tiers = await prisma.loyaltyTier.findMany({ where: { isActive: true }, orderBy: { rank: "asc" } });
  const statuses = await prisma.userLoyaltyStatus.findMany({ take: limit });
  let changes = 0;
  for (const status of statuses) {
    const periodStart = status.periodStart;
    const [spend, transactions] = await Promise.all([
      prisma.merchantPayment.aggregate({
        where: { customerUserId: status.userId, status: "SETTLED", createdAt: { gte: periodStart } },
        _sum: { amountMinor: true },
      }),
      prisma.merchantPayment.count({
        where: { customerUserId: status.userId, status: "SETTLED", createdAt: { gte: periodStart } },
      }),
    ]);
    const account = await prisma.rewardAccount.findUnique({ where: { userId: status.userId } });
    const lifetimePoints = account?.lifetimeEarnedPoints ?? 0;
    const qualified = [...tiers].reverse().find(
      (tier) =>
        (spend._sum.amountMinor ?? 0) >= tier.minSpendMinor &&
        transactions >= tier.minTransactions &&
        lifetimePoints >= tier.minLifetimePoints,
    ) ?? tiers[0]!;
    if (qualified.id === status.tierId) continue;
    const previous = await prisma.loyaltyTier.findUnique({ where: { id: status.tierId } });
    const direction = qualified.rank > (previous?.rank ?? 0) ? "UPGRADE" : "DOWNGRADE";
    await prisma.$transaction(async (tx) => {
      await tx.userLoyaltyStatus.update({
        where: { id: status.id },
        data: {
          tierId: qualified.id,
          qualifyingSpendMinor: spend._sum.amountMinor ?? 0,
          qualifyingTxCount: transactions,
          reviewAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
      await tx.loyaltyTierHistory.create({
        data: {
          userId: status.userId,
          fromTierId: status.tierId,
          toTierId: qualified.id,
          direction,
          reason: "Scheduled qualification evaluation",
          qualificationData: {
            spendMinor: spend._sum.amountMinor ?? 0,
            transactions,
            lifetimePoints,
          } as object,
          actor: "worker",
        },
      });
    });
    if (account) await prisma.rewardAccount.update({ where: { id: account.id }, data: { tierId: qualified.id } });
    await notifyOnce(prisma, {
      userId: status.userId,
      type: direction === "UPGRADE" ? "REWARD_TIER_UPGRADED" : "REWARD_TIER_DOWNGRADED",
      eventKey: `tier:${status.userId}:${qualified.id}`,
      title: `Membership ${direction === "UPGRADE" ? "upgraded" : "reviewed"}`,
      body: `Your membership tier is now ${qualified.name}.`,
      data: { tier: qualified.name },
    });
    changes += 1;
  }
  return { evaluated: statuses.length, changes };
}

export async function getMembershipView(userId: string): Promise<MembershipView> {
  await ensureDefaultTiers();
  const tiers = await prisma.loyaltyTier.findMany({ where: { isActive: true }, orderBy: { rank: "asc" } });
  let status = await prisma.userLoyaltyStatus.findUnique({ where: { userId } });
  if (!status) {
    const base = tiers[0]!;
    status = await prisma.userLoyaltyStatus.create({
      data: { userId, tierId: base.id },
    });
    await prisma.rewardAccount.updateMany({ where: { userId }, data: { tierId: base.id } });
  }
  const tier = await prisma.loyaltyTier.findUniqueOrThrow({ where: { id: status.tierId } });
  const next = tiers.find((candidate) => candidate.rank > tier.rank) ?? null;
  const history = await prisma.loyaltyTierHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { toTier: true },
  });
  const spent = status.qualifyingSpendMinor;
  const progressBps = next && next.minSpendMinor > 0 ? Math.min(10_000, Math.round((spent / next.minSpendMinor) * 10_000)) : null;
  return {
    tierName: tier.name,
    rank: tier.rank,
    pointsMultiplierBps: tier.pointsMultiplierBps,
    benefits: (tier.benefits as { benefits?: string[] } | null)?.benefits ?? (tier.benefits as string[] | null) ?? [],
    qualifyingSpendMinor: spent,
    qualifyingTxCount: status.qualifyingTxCount,
    periodStart: status.periodStart.toISOString(),
    reviewAt: status.reviewAt?.toISOString() ?? null,
    nextTier: next?.name ?? null,
    progressBps,
    history: history.map((h) => ({
      toTier: h.toTier.name,
      direction: h.direction,
      reason: h.reason,
      at: h.createdAt.toISOString(),
    })),
  };
}
