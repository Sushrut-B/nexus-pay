import { prisma } from "@nexus/database";
import { appendLedgerEntry } from "@/lib/rewards/ledger-service";
import { runCashbackWorker } from "@/lib/rewards/cashback-service";
import { runPointsEarningWorker } from "@/lib/rewards/earning-service";
import { cleanupExpiredReservations } from "@/lib/rewards/campaign-service";
import { runReferralQualification } from "@/lib/rewards/referral-service";
import { runTierEvaluation } from "@/lib/rewards/tier-service";
import { notifyOnce } from "@/lib/rewards/reward-core";

export interface RewardsRunResult {
  expiredEntries: number;
  activatedCampaigns: number;
  expiredCampaigns: number;
  exhaustedCampaigns: number;
  releasedReservations: number;
  qualifiedReferrals: number;
  evaluatedUsers: number;
  tierChanges: number;
  earning: { processed: number; points: number; cashbackMinor: number };
  cashback: { processed: number; credited: number; failed: number; unresolved: number };
}

/**
 * Single durable rewards worker. Each phase is idempotent and safe to re-run;
 * settlement and wallet credits are delegated to the existing payment engine.
 */
export async function runRewardsWorker(): Promise<RewardsRunResult> {
  const now = new Date();
  const result: RewardsRunResult = {
    expiredEntries: 0,
    activatedCampaigns: 0,
    expiredCampaigns: 0,
    exhaustedCampaigns: 0,
    releasedReservations: 0,
    qualifiedReferrals: 0,
    evaluatedUsers: 0,
    tierChanges: 0,
    earning: { processed: 0, points: 0, cashbackMinor: 0 },
    cashback: { processed: 0, credited: 0, failed: 0, unresolved: 0 },
  };

  // 1. Points expiry — positive entries whose expiry has passed. Each entry is
  //    expired once via a unique idempotency key; history is never deleted.
  const dueExpiry = await prisma.rewardLedgerEntry.findMany({
    where: { expiresAt: { lte: now }, points: { gt: 0 } },
    take: 100,
  });
  for (const entry of dueExpiry) {
    const already = await prisma.rewardLedgerEntry.findUnique({
      where: { idempotencyKey: `r8expire:${entry.id}` },
    });
    if (already) continue;
    try {
      await appendLedgerEntry({
        userId: entry.userId,
        type: "EXPIRE",
        points: -entry.points,
        referenceType: "EXPIRY",
        referenceId: entry.id,
        description: `Points expired from ${entry.description}`,
        idempotencyKey: `r8expire:${entry.id}`,
        activityType: "POINTS_EXPIRED",
      });
      await notifyOnce(prisma, {
        userId: entry.userId,
        type: "REWARD_POINTS_EXPIRING",
        eventKey: `points-expired:${entry.id}`,
        title: "Reward points expired",
        body: `${entry.points} points expired and were removed from your available balance.`,
        data: { ledgerEntryId: entry.id },
      });
      result.expiredEntries += 1;
    } catch {
      // Insufficient balance or a concurrent expiry — retried on the next pass.
    }
  }

  // 2. Campaign lifecycle.
  const approved = await prisma.rewardCampaign.findMany({
    where: { status: "APPROVED", startAt: { lte: now }, endAt: { gt: now } },
    take: 100,
  });
  for (const campaign of approved) {
    await prisma.rewardCampaign.update({ where: { id: campaign.id }, data: { status: "ACTIVE" } });
    result.activatedCampaigns += 1;
  }
  const ended = await prisma.rewardCampaign.findMany({
    where: { status: { in: ["ACTIVE", "SCHEDULED", "PAUSED"] }, endAt: { lte: now } },
    take: 100,
  });
  for (const campaign of ended) {
    await prisma.rewardCampaign.update({ where: { id: campaign.id }, data: { status: "EXPIRED" } });
    result.expiredCampaigns += 1;
  }
  const active = await prisma.rewardCampaign.findMany({
    where: { status: "ACTIVE" },
    include: { budget: true },
    take: 200,
  });
  for (const campaign of active) {
    const budget = campaign.budget;
    const exhausted =
      budget &&
      (campaign.budgetMinor > 0
        ? budget.reservedMinor + budget.consumedMinor >= campaign.budgetMinor
        : campaign.pointsBudget > 0 && budget.pointsReserved + budget.pointsConsumed >= campaign.pointsBudget);
    if (exhausted) {
      await prisma.rewardCampaign.update({ where: { id: campaign.id }, data: { status: "EXHAUSTED" } });
      result.exhaustedCampaigns += 1;
    }
  }

  // 3. Reservation cleanup and remaining phases.
  result.releasedReservations = await cleanupExpiredReservations();
  result.earning = await runPointsEarningWorker(50);
  result.cashback = await runCashbackWorker(25);
  result.qualifiedReferrals = await runReferralQualification(50);
  const tiers = await runTierEvaluation(500);
  result.evaluatedUsers = tiers.evaluated;
  result.tierChanges = tiers.changes;
  return result;
}
