/** Release 18 — currency watchlists and rate alerts (reference-ratebased only). */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type { CurrencyWatchlistView, RateAlertView, RateClassification } from "@nexus/shared-types";
import { assertCurrencyPair, decimalToRatio } from "@/lib/global/currency-service";
import { getLatestRate } from "@/lib/global/fx-service";
import { notifyGlobal, recordGlobalAudit, publishGlobalSecurity } from "@/lib/global/global-audit";

const ALERT_NOTICE =
  "Alert is based on a reference/indicative rate. It is not a guaranteed executable conversion opportunity and does not place any trade.";

function watchlistView(row: {
  id: string; name: string; pairs: unknown; createdAt: Date;
}): CurrencyWatchlistView {
  return {
    id: row.id,
    name: row.name,
    pairs: (row.pairs as CurrencyWatchlistView["pairs"]) ?? [],
    createdAt: row.createdAt.toISOString(),
  };
}

function alertView(row: {
  id: string; baseCurrency: string; quoteCurrency: string; direction: string;
  targetRateText: string | null; changePercentBps: number | null; paused: boolean;
  lastTriggeredAt: Date | null; classification: string;
}): RateAlertView {
  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    direction: row.direction as RateAlertView["direction"],
    targetRate: row.targetRateText,
    changePercentBps: row.changePercentBps,
    paused: row.paused,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
    classification: row.classification as RateClassification,
    notice: ALERT_NOTICE,
  };
}

export async function listWatchlists(userId: string): Promise<CurrencyWatchlistView[]> {
  const rows = await prisma.currencyWatchlist.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(watchlistView);
}

export async function createWatchlist(userId: string, input: { name: string; pairs: Array<{ baseCurrency: string; quoteCurrency: string }> }) {
  for (const pair of input.pairs) assertCurrencyPair(pair.baseCurrency, pair.quoteCurrency);
  const row = await prisma.currencyWatchlist.create({
    data: { userId, name: input.name, pairs: input.pairs as object },
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "WATCHLIST_CREATED", targetType: "CURRENCY_WATCHLIST", targetId: row.id });
  return watchlistView(row);
}

export async function updateWatchlist(userId: string, id: string, input: { name?: string; pairs?: Array<{ baseCurrency: string; quoteCurrency: string }> }) {
  const existing = await prisma.currencyWatchlist.findFirst({ where: { id, userId } });
  if (!existing) throw new ApiError(404, "VALIDATION_ERROR", "Watchlist not found");
  if (input.pairs) for (const pair of input.pairs) assertCurrencyPair(pair.baseCurrency, pair.quoteCurrency);
  const row = await prisma.currencyWatchlist.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.pairs ? { pairs: input.pairs as object } : {}),
    },
  });
  return watchlistView(row);
}

export async function deleteWatchlist(userId: string, id: string) {
  const result = await prisma.currencyWatchlist.deleteMany({ where: { id, userId } });
  if (!result.count) throw new ApiError(404, "VALIDATION_ERROR", "Watchlist not found");
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "WATCHLIST_DELETED", targetType: "CURRENCY_WATCHLIST", targetId: id });
}

export async function listAlerts(userId: string): Promise<RateAlertView[]> {
  const rows = await prisma.rateAlert.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return rows.map(alertView);
}

export async function createAlert(userId: string, input: {
  baseCurrency: string; quoteCurrency: string; direction: "ABOVE" | "BELOW" | "CHANGE_PERCENT";
  targetRate?: string; changePercentBps?: number; paused?: boolean;
}) {
  assertCurrencyPair(input.baseCurrency, input.quoteCurrency);
  if (input.targetRate) decimalToRatio(input.targetRate);
  const row = await prisma.rateAlert.create({
    data: {
      userId,
      baseCurrency: input.baseCurrency.toUpperCase(),
      quoteCurrency: input.quoteCurrency.toUpperCase(),
      direction: input.direction,
      targetRateText: input.targetRate ?? null,
      changePercentBps: input.changePercentBps ?? null,
      paused: input.paused ?? false,
    },
  });
  await publishGlobalSecurity({ type: "GLOBAL_ALERT_CHANGED", actorId: userId, subjectId: userId, metadata: { alertId: row.id } });
  return alertView(row);
}

export async function setAlertPaused(userId: string, id: string, paused: boolean) {
  const result = await prisma.rateAlert.updateMany({ where: { id, userId }, data: { paused } });
  if (!result.count) throw new ApiError(404, "VALIDATION_ERROR", "Alert not found");
  return listAlerts(userId);
}

export async function deleteAlert(userId: string, id: string) {
  const result = await prisma.rateAlert.deleteMany({ where: { id, userId } });
  if (!result.count) throw new ApiError(404, "VALIDATION_ERROR", "Alert not found");
  await publishGlobalSecurity({ type: "GLOBAL_ALERT_CHANGED", actorId: userId, subjectId: userId, metadata: { alertId: id, deleted: true } });
}

/** Worker entry. Dedupes by 24h per alert and never presents an executable claim. */
export async function evaluateAlerts(): Promise<number> {
  const alerts = await prisma.rateAlert.findMany({ where: { paused: false } });
  let triggered = 0;
  const dedupeWindow = Date.now() - 24 * 60 * 60 * 1000;
  for (const alert of alerts) {
    if (alert.lastTriggeredAt && alert.lastTriggeredAt.getTime() > dedupeWindow) continue;
    let latest;
    try {
      latest = await getLatestRate(alert.baseCurrency, alert.quoteCurrency);
    } catch {
      continue; // provider unavailable — do not fabricate a rate
    }
    if (latest.isStale) continue;
    const current = decimalToRatio(latest.rate);
    let shouldTrigger = false;
    if (alert.direction === "ABOVE" || alert.direction === "BELOW") {
      if (!alert.targetRateText) continue;
      const target = decimalToRatio(alert.targetRateText);
      const left = current.numerator * target.denominator;
      const right = target.numerator * current.denominator;
      shouldTrigger = alert.direction === "ABOVE" ? left >= right : left <= right;
    } else if (alert.changePercentBps) {
      // Percentage movement is measured against the previous persisted reference
      // rate. All comparisons use exact bigint cross-multiplication.
      const previous = await prisma.fxRate.findFirst({
        where: {
          baseCurrency: alert.baseCurrency, quoteCurrency: alert.quoteCurrency,
          id: { not: latest.id },
        },
        orderBy: { fetchedAt: "desc" },
      });
      if (!previous) continue;
      const prev = decimalToRatio(previous.rateText);
      const diff = current.numerator * prev.denominator - prev.numerator * current.denominator;
      const absolute = diff < 0n ? -diff : diff;
      const threshold = BigInt(alert.changePercentBps) * current.denominator * prev.denominator;
      shouldTrigger = absolute * 10000n >= threshold;
    }
    if (!shouldTrigger) continue;
    await prisma.rateAlert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date() } });
    await notifyGlobal(
      alert.userId,
      "GLOBAL_RATE_ALERT_TRIGGERED",
      `Rate alert: ${alert.baseCurrency}/${alert.quoteCurrency}`,
      `${ALERT_NOTICE} Latest reference rate ${latest.rate} at ${latest.asOf}.`,
      { alertId: alert.id, pair: `${alert.baseCurrency}/${alert.quoteCurrency}`, rate: latest.rate },
    );
    await recordGlobalAudit({ actorType: "WORKER", actorId: "rate-alert-evaluator", action: "RATE_ALERT_TRIGGERED", targetType: "RATE_ALERT", targetId: alert.id, metadata: { rate: latest.rate } });
    triggered += 1;
  }
  return triggered;
}
