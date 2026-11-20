import { prisma } from "@nexus/database";
import type { NetWorthView, FixedIncomeView } from "@nexus/shared-types";
import { getAccountAnalytics } from "@/lib/accounts/accounts-service";

/** Net worth reuses the existing account analytics engine (wallet + external balances - liabilities). */
export async function getNetWorth(userId: string): Promise<NetWorthView> {
  const [analytics, holdings, fixed] = await Promise.all([
    getAccountAnalytics(userId, "ALL"),
    prisma.investmentHolding.findMany({ where: { userId } }),
    prisma.fixedIncomeAsset.findMany({ where: { userId } }),
  ]);
  const walletMinor = await getWalletMinor(userId);
  const accountsTotalMinor = analytics.cashBalanceMinor ?? 0;
  const liabilitiesMinor = analytics.liabilityMinor ?? 0;
  const investmentsMinor = holdings.reduce((sum, h) => sum + h.valueMinor, 0);
  const fixedIncomeMinor = fixed.reduce((sum, a) => sum + (a.currentValueMinor ?? a.principalMinor), 0);
  const bankMinor = Math.max(0, accountsTotalMinor - walletMinor);
  const totalAssetsMinor = accountsTotalMinor + investmentsMinor + fixedIncomeMinor;
  const totalLiabilitiesMinor = liabilitiesMinor;
  const netWorthMinor = totalAssetsMinor - totalLiabilitiesMinor;
  const completeness = holdings.length === 0 && fixed.length === 0 ? "PARTIAL" : "AVAILABLE";
  return {
    totalAssetsMinor, totalLiabilitiesMinor, netWorthMinor,
    walletMinor, bankMinor,
    investmentsMinor, fixedIncomeMinor, liabilitiesMinor,
    completeness,
    capturedAt: new Date().toISOString(), currency: "INR",
    notice: "Net worth reuses the live Raftline wallet read and existing linked-account balances. Investment holdings are external provider snapshots. Rewards points are not cash and are excluded. Manually entered assets are labelled as user-reported.",
  };
}

async function getWalletMinor(userId: string): Promise<number> {
  const wallet = await prisma.wallet.findFirst({ where: { userId, status: "ACTIVE" } });
  if (!wallet) return 0;
  try {
    const { createRaftlineClient } = await import("@nexus/api-client");
    const account = await createRaftlineClient().getAccount(wallet.raftlineAccountId!);
    return account?.availableBalanceCents ?? 0;
  } catch {
    return 0;
  }
}

export async function captureNetWorthSnapshot(userId: string) {
  const view = await getNetWorth(userId);
  return prisma.netWorthSnapshot.create({
    data: {
      userId, totalAssetsMinor: view.totalAssetsMinor,
      totalLiabilitiesMinor: view.totalLiabilitiesMinor, netWorthMinor: view.netWorthMinor,
      walletMinor: view.walletMinor, bankMinor: view.bankMinor,
      investmentsMinor: view.investmentsMinor, fixedIncomeMinor: view.fixedIncomeMinor,
      liabilitiesMinor: view.liabilitiesMinor, completeness: view.completeness,
      breakdown: {
        source: "existing account analytics + investment snapshots",
        notice: view.notice,
      },
    },
  });
}

export async function getWealthHistory(userId: string) {
  const rows = await prisma.netWorthSnapshot.findMany({
    where: { userId }, orderBy: { capturedAt: "asc" }, take: 200,
  });
  return rows.map((row) => ({
    capturedAt: row.capturedAt.toISOString(), netWorthMinor: row.netWorthMinor,
    totalAssetsMinor: row.totalAssetsMinor, totalLiabilitiesMinor: row.totalLiabilitiesMinor,
    completeness: row.completeness,
  }));
}

export async function getAssets(userId: string) {
  const [holdings, fixed] = await Promise.all([
    prisma.investmentHolding.findMany({ where: { userId } }),
    prisma.fixedIncomeAsset.findMany({ where: { userId } }),
  ]);
  return {
    investments: holdings.map((h) => ({
      id: h.id, name: h.name, valueMinor: h.valueMinor, category: h.assetClass,
      source: h.source, providerReportedAt: h.providerReportedAt.toISOString(),
    })),
    fixedIncome: fixed.map((a) => ({
      id: a.id, name: a.name, valueMinor: a.currentValueMinor ?? a.principalMinor,
      category: a.category, source: a.source,
    })),
    notice: "User-reported assets are not independently verified.",
  };
}

export async function getLiabilities(userId: string) {
  const analytics = await getAccountAnalytics(userId, "ALL");
  return {
    totalMinor: analytics.liabilityMinor ?? 0,
    breakdown: analytics.accountBreakdown ?? [],
    notice: "Liabilities come from existing linked credit-card and loan data. They are never added to assets.",
  };
}

export async function listFixedIncome(userId: string): Promise<FixedIncomeView[]> {
  const rows = await prisma.fixedIncomeAsset.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((row) => ({
    id: row.id, name: row.name, category: row.category, principalMinor: row.principalMinor,
    interestRateBps: row.interestRateBps, maturityDate: row.maturityDate?.toISOString() ?? null,
    currentValueMinor: row.currentValueMinor,
    source: row.source, isSandbox: row.source === "PROVIDER",
    notice: row.source === "PROVIDER" ? "Provider-reported." : "User-reported — not independently verified.",
  }));
}

export async function createFixedIncome(userId: string, input: {
  name: string; category: string; principalMinor: number; interestRateBps?: number;
  maturityDate?: string; currentValueMinor?: number; issuer?: string; creditRating?: string; source?: "USER_REPORTED" | "PROVIDER";
}) {
  const row = await prisma.fixedIncomeAsset.create({
    data: {
      userId, name: input.name, category: input.category, principalMinor: input.principalMinor,
      interestRateBps: input.interestRateBps ?? null,
      maturityDate: input.maturityDate ? new Date(input.maturityDate) : null,
      currentValueMinor: input.currentValueMinor ?? null,
      issuer: input.issuer ?? null, creditRating: input.creditRating ?? null,
      source: input.source ?? "USER_REPORTED",
      riskDisclosure: "Fixed-income products carry interest-rate, credit and liquidity risk. Past performance does not guarantee future results.",
    },
  });
  return row;
}
