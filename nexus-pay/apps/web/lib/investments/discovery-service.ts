import { createHmac } from "node:crypto";
import { prisma } from "@nexus/database";
import type { FundView, InstrumentView, WatchlistView } from "@nexus/shared-types";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import { getInvestmentAdapter, listInvestmentProviders } from "@/lib/investments/providers";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

function fundView(row: {
  id: string; code: string; name: string; amc: string; category: string; planType: string;
  optionType: string; navMinor: number | null; navDate: Date | null; expenseRatioBps: number | null;
  riskometer: string | null; benchmark: string | null; minInvestmentMinor: number | null;
  minSipMinor: number | null; performance: unknown; source: string; retrievedAt: Date;
}): FundView {
  return {
    id: row.id, code: row.code, name: row.name, amc: row.amc,
    category: row.category as FundView["category"], planType: row.planType, optionType: row.optionType,
    navMinor: row.navMinor, navDate: row.navDate?.toISOString() ?? null,
    expenseRatioBps: row.expenseRatioBps, riskometer: row.riskometer, benchmark: row.benchmark,
    minInvestmentMinor: row.minInvestmentMinor, minSipMinor: row.minSipMinor,
    performance: (row.performance as Record<string, number>) ?? {},
    source: row.source, retrievedAt: row.retrievedAt.toISOString(), isSandbox: true,
  };
}

function instrumentView(row: {
  id: string; symbol: string; name: string; exchange: string | null; category: string;
  sector: string | null; source: string; retrievedAt: Date;
}, price: { priceMinor: number; changeMinor: number; changePct: number; feedType: string } | null): InstrumentView {
  return {
    id: row.id, symbol: row.symbol, name: row.name, exchange: row.exchange,
    category: row.category as InstrumentView["category"], sector: row.sector,
    priceMinor: price?.priceMinor ?? null, changeMinor: price?.changeMinor ?? 0,
    changePct: price?.changePct ?? 0, feedType: price?.feedType ?? "SANDBOX",
    source: row.source, retrievedAt: row.retrievedAt.toISOString(), isSandbox: true,
  };
}

export async function listFunds(filters: { category?: string; amc?: string; q?: string } = {}) {
  const rows = await prisma.mutualFundScheme.findMany({
    where: {
      ...(filters.category ? { category: filters.category as never } : {}),
      ...(filters.amc ? { amc: { contains: filters.amc, mode: "insensitive" } } : {}),
      ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { code: { contains: filters.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: { name: "asc" }, take: 200,
  });
  return rows.map(fundView);
}

export async function getFund(id: string) {
  const row = await prisma.mutualFundScheme.findFirst({ where: { OR: [{ id }, { code: id }] } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Mutual fund not found.");
  return fundView(row);
}

export async function searchInstruments(query: string) {
  if (query.trim().length < 2) return [];
  const provider = listInvestmentProviders().find((item) => item.available);
  if (!provider) {
    const stored = await prisma.investmentInstrument.findMany({
      where: { OR: [{ symbol: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }] },
      take: 50,
    });
    return Promise.all(stored.map(async (row) => {
      const price = await prisma.instrumentPriceHistory.findFirst({ where: { instrumentId: row.id }, orderBy: { recordedAt: "desc" } });
      return instrumentView(row, price);
    }));
  }
  const adapter = getInvestmentAdapter(provider.code);
  const results = await adapter.searchInstruments(query);
  const out: InstrumentView[] = [];
  for (const item of results) {
    const row = await prisma.investmentInstrument.upsert({
      where: { symbol: item.symbol },
      create: {
        providerId: (await prisma.investmentProvider.findUniqueOrThrow({ where: { code: provider.code } })).id,
        symbol: item.symbol, name: item.name, exchange: item.exchange ?? null,
        category: item.category, sector: item.sector ?? null,
        source: "SANDBOX_FIXTURE", retrievedAt: item.retrievedAt,
      },
      update: { name: item.name, retrievedAt: item.retrievedAt },
    });
    await prisma.instrumentPriceHistory.create({
      data: {
        instrumentId: row.id, priceMinor: item.priceMinor, changeMinor: item.changeMinor,
        changePct: item.changePct, feedType: item.feedType, recordedAt: item.retrievedAt,
      },
    });
    out.push(instrumentView(row, item));
  }
  return out;
}

export async function getInstrument(id: string) {
  const row = await prisma.investmentInstrument.findFirst({ where: { OR: [{ id }, { symbol: id }] } });
  if (!row) throw new ApiError(404, "PAYMENT_ERROR", "Instrument not found.");
  const price = await prisma.instrumentPriceHistory.findFirst({ where: { instrumentId: row.id }, orderBy: { recordedAt: "desc" } });
  return instrumentView(row, price);
}

export async function listWatchlists(userId: string): Promise<WatchlistView[]> {
  const rows = await prisma.investmentWatchlist.findMany({
    where: { userId }, include: { items: { include: { instrument: true } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], take: 50,
  });
  return Promise.all(rows.map(async (row) => ({
    id: row.id, name: row.name, isDefault: row.isDefault,
    items: await Promise.all(row.items.map(async (item) => {
      const price = await prisma.instrumentPriceHistory.findFirst({
        where: { instrumentId: item.instrumentId }, orderBy: { recordedAt: "desc" },
      });
      return instrumentView(item.instrument, price);
    })),
  })));
}

export async function createWatchlist(userId: string, input: { name: string; isDefault: boolean }) {
  const row = await prisma.investmentWatchlist.create({
    data: { userId, name: input.name, isDefault: input.isDefault },
  });
  await publishSecurityEvent({
    eventId: `inv_watchlist_${row.id}`, type: "INVESTMENT_WATCHLIST_CHANGED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "investments",
  });
  return { id: row.id, name: row.name, isDefault: row.isDefault, items: [] };
}

async function ownedWatchlist(userId: string, id: string) {
  const row = await prisma.investmentWatchlist.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Watchlist not found.");
  return row;
}

export async function updateWatchlist(userId: string, id: string, input: { name?: string; isDefault?: boolean }) {
  await ownedWatchlist(userId, id);
  const row = await prisma.investmentWatchlist.update({
    where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) },
  });
  return { id: row.id, name: row.name, isDefault: row.isDefault };
}

export async function deleteWatchlist(userId: string, id: string) {
  await ownedWatchlist(userId, id);
  await prisma.investmentWatchlist.delete({ where: { id } });
  return { id, deleted: true };
}

export async function addWatchlistItem(userId: string, watchlistId: string, instrumentId: string) {
  await ownedWatchlist(userId, watchlistId);
  const instrument = await prisma.investmentInstrument.findUnique({ where: { id: instrumentId } });
  if (!instrument) throw new ApiError(404, "PAYMENT_ERROR", "Instrument not found.");
  await prisma.investmentWatchlistItem.upsert({
    where: { watchlistId_instrumentId: { watchlistId, instrumentId } },
    create: { watchlistId, instrumentId }, update: {},
  });
  return { watchlistId, instrumentId };
}

export async function removeWatchlistItem(userId: string, watchlistId: string, instrumentId: string) {
  await ownedWatchlist(userId, watchlistId);
  await prisma.investmentWatchlistItem.deleteMany({ where: { watchlistId, instrumentId } });
  return { watchlistId, instrumentId, removed: true };
}

export async function createPriceAlert(userId: string, input: { instrumentId: string; direction: "ABOVE" | "BELOW"; thresholdMinor: number }) {
  const instrument = await prisma.investmentInstrument.findUnique({ where: { id: input.instrumentId } });
  if (!instrument) throw new ApiError(404, "PAYMENT_ERROR", "Instrument not found.");
  const row = await prisma.investmentPriceAlert.upsert({
    where: {
      userId_instrumentId_direction_thresholdMinor: {
        userId, instrumentId: input.instrumentId, direction: input.direction, thresholdMinor: input.thresholdMinor,
      },
    },
    create: { userId, instrumentId: input.instrumentId, direction: input.direction, thresholdMinor: input.thresholdMinor },
    update: { status: "ACTIVE" },
  });
  return row;
}

export async function listPriceAlerts(userId: string) {
  return prisma.investmentPriceAlert.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
}

/** Evaluates alerts against the latest provider-reported price; dedupes by lastTriggeredAt. */
export async function evaluatePriceAlerts() {
  const alerts = await prisma.investmentPriceAlert.findMany({ where: { status: "ACTIVE" } });
  let triggered = 0;
  for (const alert of alerts) {
    const price = await prisma.instrumentPriceHistory.findFirst({
      where: { instrumentId: alert.instrumentId }, orderBy: { recordedAt: "desc" },
    });
    if (!price || (price.feedType !== "SANDBOX" && price.feedType !== "LIVE")) continue;
    const crossed = alert.direction === "ABOVE" ? price.priceMinor >= alert.thresholdMinor : price.priceMinor <= alert.thresholdMinor;
    if (!crossed || (alert.lastTriggeredAt && alert.lastTriggeredAt.getTime() > price.recordedAt.getTime())) continue;
    await prisma.investmentPriceAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date() } });
    await createNotificationForAlert(alert.userId, alert.id);
    triggered += 1;
  }
  return { triggered };
}

async function createNotificationForAlert(userId: string, alertId: string) {
  const { createNotification } = await import("@/lib/social/shared");
  await createNotification(prisma, {
    userId, type: "INVESTMENT_PRICE_ALERT", title: "Price alert",
    body: "A watchlist price alert was triggered using provider-reported data. No trade was placed.",
    data: { alertId },
  });
}

export function documentToken(documentId: string, expiresAt: number) {
  return createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${documentId}:${expiresAt}`).digest("hex");
}

export async function getDocumentLink(userId: string, documentId: string) {
  const row = await prisma.investmentDocument.findFirst({ where: { id: documentId, userId, status: "READY", storagePath: { not: null } } });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Investment document not found.");
  const expiresAt = Date.now() + 5 * 60_000;
  await securityAudit({ actorType: "USER", actorId: userId, action: "INVESTMENT_DOCUMENT_ACCESSED", targetType: "investment_document", targetId: documentId });
  return { token: documentToken(documentId, expiresAt), expiresAt, fileName: row.fileName };
}
