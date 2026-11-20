/**
 * Release 18 — exchange-rate engine.
 *
 * Reads are served from persisted, source-attributed rates. Provider fetches are
 * explicit (worker or on-demand) and are classified by the provider; sandbox
 * values are REFERENCE only and never executable. No rate is hardcoded here.
 */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import { getServerEnv } from "@/lib/env";
import type { FxRateView, ConversionView, RateClassification } from "@nexus/shared-types";
import { assertCurrencyPair, convertWithRate, decimalToRatio } from "@/lib/global/currency-service";
import { getFxAdapter, ensureFxProviderRecords, listFxProviders } from "@/lib/global/providers";
import type { FxRate } from "@prisma/client";

const INDICATIVE_NOTICE =
  "Indicative estimate at a reference rate. This is not an executable exchange rate and no currency conversion is performed by Nexus Pay. Fees and taxes are not included unless a verified provider quote states otherwise.";

function toView(row: FxRate): FxRateView {
  const staleHours = getServerEnv().NEXUS_GLOBAL_RATE_STALE_HOURS;
  const isStale = row.fetchedAt.getTime() < Date.now() - staleHours * 60 * 60 * 1000;
  return {
    id: row.id,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    rate: row.rateText,
    classification: row.classification as RateClassification,
    providerCode: row.providerCode,
    sourceRef: row.sourceRef,
    asOf: row.asOf.toISOString(),
    fetchedAt: row.fetchedAt.toISOString(),
    isStale,
    precision: row.precision,
    notice: isStale
      ? `${INDICATIVE_NOTICE} This rate is STALE (older than ${staleHours} hours).`
      : INDICATIVE_NOTICE,
  };
}

function rateId(base: string, quote: string, provider: string, classification: string, asOf: Date): string {
  return `${provider}:${base}/${quote}:${classification}:${asOf.toISOString()}`;
}

/** Persist provider rates. Only the adapter decides the classification value. */
export async function storeRates(
  rates: Array<{
    baseCurrency: string;
    quoteCurrency: string;
    rateText: string;
    asOf: Date;
    classification: RateClassification;
    providerCode: string;
    sourceRef: string | null;
    precision: number;
    isHistorical?: boolean;
  }>,
) {
  let count = 0;
  for (const rate of rates) {
    const id = rateId(
      rate.baseCurrency, rate.quoteCurrency, rate.providerCode, rate.classification, rate.asOf,
    );
    await prisma.fxRate.upsert({
      where: { id },
      create: {
        id,
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        rateText: rate.rateText,
        classification: rate.classification,
        providerCode: rate.providerCode,
        sourceRef: rate.sourceRef,
        asOf: rate.asOf,
        precision: rate.precision,
        isHistorical: rate.isHistorical ?? false,
      },
      update: {
        rateText: rate.rateText,
        sourceRef: rate.sourceRef,
        precision: rate.precision,
      },
    });
    count += 1;
  }
  return count;
}

/** Fetch and persist the latest rate from a configured provider. */
export async function syncLatestRate(base: string, quote: string, providerCode = "sandbox-fx") {
  assertCurrencyPair(base, quote);
  const adapter = getFxAdapter(providerCode);
  if (!adapter.capabilities.latest) throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Provider does not support latest rates");
  const data = await adapter.fetchLatest(base, quote);
  // Sandbox data is strictly REFERENCE. A production adapter may return
  // PROVIDER_QUOTE, but never EXECUTABLE_QUOTE without an execution counterparty.
  const classification: RateClassification = adapter.mode === "SANDBOX" ? "REFERENCE" : "PROVIDER_QUOTE";
  await storeRates([{ ...data, classification, providerCode }]);
  return getLatestRate(base, quote);
}

export async function getLatestRate(base: string, quote: string): Promise<FxRateView> {
  assertCurrencyPair(base, quote);
  const classificationFilter = { in: ["REFERENCE", "INDICATIVE", "PROVIDER_QUOTE"] };
  const row = await prisma.fxRate.findFirst({
    where: {
      baseCurrency: base.toUpperCase(),
      quoteCurrency: quote.toUpperCase(),
      isHistorical: false,
      classification: classificationFilter,
    },
    orderBy: { fetchedAt: "desc" },
  }) ?? await prisma.fxRate.findFirst({
    where: {
      baseCurrency: quote.toUpperCase(),
      quoteCurrency: base.toUpperCase(),
      isHistorical: false,
      classification: classificationFilter,
    },
    orderBy: { fetchedAt: "desc" },
  });
  if (!row) {
    throw new ApiError(
      503,
      "RAFTLINE_UNAVAILABLE",
      `No source-attributed rate is available for ${base.toUpperCase()}/${quote.toUpperCase()}. Enable an FX provider and synchronise rates first.`,
    );
  }
  return toView(row);
}

export async function getHistoricalRates(base: string, quote: string, from: Date, to: Date): Promise<FxRateView[]> {
  assertCurrencyPair(base, quote);
  if (to < from) throw new ApiError(400, "VALIDATION_ERROR", "Historical range end must be after start");
  const rows = await prisma.fxRate.findMany({
    where: {
      baseCurrency: base.toUpperCase(),
      quoteCurrency: quote.toUpperCase(),
      asOf: { gte: from, lte: to },
    },
    orderBy: { asOf: "asc" },
    take: 500,
  });
  return rows.map(toView);
}

export async function syncHistoricalRates(base: string, quote: string, from: Date, to: Date, providerCode = "sandbox-fx") {
  assertCurrencyPair(base, quote);
  const adapter = getFxAdapter(providerCode);
  if (!adapter.capabilities.historical) throw new ApiError(503, "RAFTLINE_UNAVAILABLE", "Provider does not support historical rates");
  const data = await adapter.fetchHistorical(base, quote, from, to);
  return storeRates(data.map((d) => ({
    ...d,
    classification: "HISTORICAL" as RateClassification,
    providerCode,
    isHistorical: true,
  })));
}

/** Explicit conversion. The original amount is preserved; only the result is new. */
export async function convert(input: {
  from: string;
  to: string;
  amountMinor: number;
  asOf?: Date;
}): Promise<ConversionView> {
  assertCurrencyPair(input.from, input.to);
  const rate = await getLatestRate(input.from, input.to);
  decimalToRatio(rate.rate); // validate exactness before use
  // getLatestRate returns base->quote; if the caller wants the inverse pair and
  // only the inverse is stored, we invert the exact decimal string.
  const direct = rate.baseCurrency === input.from.toUpperCase();
  const rateText = direct ? rate.rate : invertExact(rate.rate);
  const convertedMinor = convertWithRate(input.amountMinor, input.from, input.to, rateText);
  return {
    sourceCurrency: input.from.toUpperCase(),
    targetCurrency: input.to.toUpperCase(),
    originalMinor: input.amountMinor,
    convertedMinor,
    rate: rateText,
    classification: rate.classification,
    providerCode: rate.providerCode,
    rateAsOf: rate.asOf,
    rounding: "HALF_UP to target currency minor units",
    feesIncluded: false,
    feeNotice: "Provider fees and taxes are not included and have not been estimated.",
    notice: INDICATIVE_NOTICE,
  };
}

function invertExact(text: string): string {
  const { numerator, denominator } = decimalToRatio(text);
  const precision = 12;
  const scaled = (denominator * 10n ** BigInt(precision)) / numerator;
  const raw = scaled.toString().padStart(precision + 1, "0");
  const whole = raw.slice(0, raw.length - precision);
  const fraction = raw.slice(raw.length - precision).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export async function listRecentRates(limit = 20): Promise<FxRateView[]> {
  const rows = await prisma.fxRate.findMany({ orderBy: { fetchedAt: "desc" }, take: limit });
  return rows.map(toView);
}

export { ensureFxProviderRecords, listFxProviders };
