import { prisma } from "@nexus/database";
import type {
  PortfolioView, PortfolioPerformancePoint, PortfolioInsightView, InvestmentTransactionView,
} from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { createNotification } from "@/lib/social/shared";

const staleAfterMs = () => getServerEnv().NEXUS_INVESTMENTS_STALE_HOURS * 3_600_000;

export async function getPortfolio(userId: string): Promise<PortfolioView> {
  const [accounts, holdings] = await Promise.all([
    prisma.investmentAccount.findMany({ where: { userId, status: "ACTIVE" }, include: { connection: { include: { provider: true } } } }),
    prisma.investmentHolding.findMany({ where: { userId } }),
  ]);
  const investedMinor = holdings.reduce((sum, h) => sum + (h.costMinor ?? 0), 0);
  const currentValueMinor = holdings.reduce((sum, h) => sum + h.valueMinor, 0);
  const absoluteReturnMinor = currentValueMinor - investedMinor;
  const returnPctBps = investedMinor > 0 ? Math.round((absoluteReturnMinor / investedMinor) * 10_000) : 0;

  const allocationMap = new Map<string, number>();
  for (const holding of holdings) {
    allocationMap.set(holding.assetClass, (allocationMap.get(holding.assetClass) ?? 0) + holding.valueMinor);
  }
  const allocation = Array.from(allocationMap.entries())
    .map(([key, valueMinor]) => ({ key, valueMinor, pctBps: currentValueMinor > 0 ? Math.round((valueMinor / currentValueMinor) * 10_000) : 0 }))
    .sort((a, b) => b.valueMinor - a.valueMinor);

  const now = Date.now();
  const providerCodes = new Set(accounts.map((a) => a.connection.provider.code));
  const lastUpdated = holdings.reduce<Date | null>((latest, h) => (!latest || h.providerReportedAt > latest ? h.providerReportedAt : latest), null);
  return {
    investedMinor, currentValueMinor, absoluteReturnMinor, returnPctBps, allocation,
    accounts: accounts.map((account) => {
      const own = holdings.filter((h) => h.accountId === account.id);
      return {
        id: account.id, providerCode: account.connection.provider.code, name: account.name,
        accountType: account.accountType, maskedNumber: account.maskedNumber,
        valueMinor: own.reduce((sum, h) => sum + h.valueMinor, 0),
        costMinor: own.reduce((sum, h) => sum + (h.costMinor ?? 0), 0),
        lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
        source: account.source, isSandbox: account.connection.provider.mode === "SANDBOX",
      };
    }),
    holdings: holdings.map((holding) => ({
      id: holding.id, accountId: holding.accountId, name: holding.name,
      category: holding.assetClass, quantityMinor: holding.quantityMinor,
      navMinor: holding.navMinor, costMinor: holding.costMinor, valueMinor: holding.valueMinor,
      currency: holding.currency, source: holding.source,
      providerReportedAt: holding.providerReportedAt.toISOString(),
      isStale: now - holding.providerReportedAt.getTime() > staleAfterMs(),
      isSandbox: true,
    })),
    providerCount: providerCodes.size, holdingsCount: holdings.length,
    lastUpdatedAt: lastUpdated?.toISOString() ?? null,
    isSandbox: true,
    hasHistory: (await prisma.portfolioSnapshot.count({ where: { userId } })) > 1,
    notice: "Holdings are provider-reported snapshots, not wallet balances. Past performance does not guarantee future results. No investment advice is provided.",
  };
}

export async function getPerformance(userId: string): Promise<PortfolioPerformancePoint[]> {
  const rows = await prisma.portfolioSnapshot.findMany({
    where: { userId }, orderBy: { capturedAt: "asc" }, take: 500,
  });
  return rows.map((row) => ({
    capturedAt: row.capturedAt.toISOString(),
    investedMinor: row.investedMinor, currentValueMinor: row.currentValueMinor,
  }));
}

export async function capturePortfolioSnapshot(userId: string) {
  const portfolio = await getPortfolio(userId);
  const row = await prisma.portfolioSnapshot.create({
    data: {
      userId, investedMinor: portfolio.investedMinor, currentValueMinor: portfolio.currentValueMinor,
      absoluteReturnMinor: portfolio.absoluteReturnMinor, returnPctBps: portfolio.returnPctBps,
      holdingsCount: portfolio.holdingsCount,
      allocation: portfolio.allocation as object,
    },
  });
  for (const item of portfolio.allocation) {
    await prisma.portfolioAllocationSnapshot.create({
      data: { snapshotId: row.id, dimension: "ASSET_CLASS", key: item.key, valueMinor: item.valueMinor, pctBps: item.pctBps },
    });
  }
  return row;
}

export async function listInvestmentTransactions(userId: string) {
  const rows = await prisma.investmentTransaction.findMany({
    where: { userId }, include: { account: true }, orderBy: { occurredAt: "desc" }, take: 200,
  });
  return rows.map((row): InvestmentTransactionView => ({
    id: row.id, accountId: row.accountId, providerRef: row.providerRef, type: row.type,
    amountMinor: row.amountMinor, quantityMinor: row.quantityMinor, priceMinor: row.priceMinor,
    occurredAt: row.occurredAt.toISOString(), providerStatus: row.providerStatus,
    source: row.source, isSandbox: true,
  }));
}

/** Explainable, educational insights. No portfolio health score and no recommendations. */
export async function generateInsights(userId: string): Promise<PortfolioInsightView[]> {
  const portfolio = await getPortfolio(userId);
  const insights: PortfolioInsightView[] = [];
  const dataAsOfDate = portfolio.lastUpdatedAt ? new Date(portfolio.lastUpdatedAt) : new Date();
  const dataAsOf = dataAsOfDate.toISOString();
  for (const item of portfolio.allocation) {
    if (item.pctBps < 1000) continue;
    insights.push({
      id: `allocation-${item.key}`, kind: "ASSET_ALLOCATION",
      title: `${item.key} exposure`,
      explanation: `Your portfolio has ${(item.pctBps / 100).toFixed(1)}% exposure to ${item.key}. This is based on the latest provider-reported holdings synchronized on ${dataAsOf.slice(0, 10)}.`,
      evidence: { key: item.key, valueMinor: item.valueMinor, pctBps: item.pctBps }, dataAsOf,
    });
  }
  if (portfolio.holdings.length > 0 && portfolio.holdings.every((h) => h.isSandbox)) {
    insights.push({
      id: "sandbox-notice", kind: "DATA_QUALITY",
      title: "Sandbox data only",
      explanation: "All current holdings come from a clearly labelled sandbox provider. They are test fixtures and are not real investments.",
      evidence: { holdingsCount: portfolio.holdings.length }, dataAsOf,
    });
  }
  const stale = portfolio.holdings.filter((h) => h.isStale).length;
  if (stale > 0) {
    insights.push({
      id: "stale-valuations", kind: "DATA_FRESHNESS",
      title: "Some valuations may be stale",
      explanation: `${stale} holding(s) have not been refreshed within the configured freshness window. Values are shown with their provider-reported timestamp.`,
      evidence: { staleCount: stale }, dataAsOf,
    });
  }
  for (const insight of insights) {
    insight.id = `${userId}:${insight.id}`;
    const existing = await prisma.portfolioInsight.findFirst({ where: { id: insight.id, userId } });
    if (existing) {
      await prisma.portfolioInsight.update({
        where: { id: existing.id },
        data: { explanation: insight.explanation, evidence: insight.evidence as object, dataAsOf: dataAsOfDate },
      });
    } else {
      await prisma.portfolioInsight.create({
        data: {
          id: insight.id, userId, kind: insight.kind, title: insight.title,
          explanation: insight.explanation, evidence: insight.evidence as object, dataAsOf: dataAsOfDate,
        },
      });
    }
  }
  const persisted = await prisma.portfolioInsight.findMany({
    where: { userId }, orderBy: { createdAt: "desc" }, take: 30,
  });
  return persisted.map((row) => ({
    id: row.id, kind: row.kind, title: row.title, explanation: row.explanation,
    evidence: row.evidence as Record<string, unknown>, dataAsOf: row.dataAsOf.toISOString(),
  }));
}

export async function listInsights(userId: string) {
  const rows = await prisma.portfolioInsight.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 });
  return rows.map((row) => ({
    id: row.id, kind: row.kind, title: row.title, explanation: row.explanation,
    evidence: row.evidence as Record<string, unknown>, dataAsOf: row.dataAsOf.toISOString(),
  }));
}

export async function notifyMilestone(userId: string, title: string, body: string) {
  await createNotification(prisma, {
    userId, type: "INVESTMENT_GOAL_MILESTONE", title, body, data: {},
  });
}

export function requireInvestmentUserId(userId: string | undefined): string {
  if (!userId) throw new ApiError(401, "AUTHENTICATION_ERROR", "Please sign in to continue.");
  return userId;
}
