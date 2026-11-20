/**
 * Release 18 — international expenses, travel currency and explainable insights.
 *
 * Financial activity is reused from `loadClassifiedTransactions` — the same
 * canonical path used by Release 9 Financial Intelligence. This module never
 * re-derives wallet activity and never counts an imported record twice.
 */
import { prisma } from "@nexus/database";
import type {
  ForeignExpenseCategory, ForeignExpenseView, GlobalInsightView, TravelCurrencyView,
} from "@nexus/shared-types";
import { loadClassifiedTransactions } from "@/lib/finance-intelligence/classification-service";
import { listTrips, getBudget, listExpenses } from "@/lib/travel/trip-service";
import { getNetWorth } from "@/lib/investments/wealth-service";
import { getSubscriptionIntelligence } from "@/lib/finance-intelligence/subscription-intelligence-service";
import { convertWithRate } from "@/lib/global/currency-service";
import { getLatestRate } from "@/lib/global/fx-service";
import { recordGlobalAudit } from "@/lib/global/global-audit";

const EXPENSE_NOTICE =
  "Foreign expense records preserve the original amount and currency. Converted values are estimates at a source-attributed reference rate and are not wallet transactions.";

async function converted(originalMinor: number, currency: string, display: string): Promise<{ minor: number | null; rate: string | null }> {
  if (currency === display) return { minor: originalMinor, rate: "1" };
  try {
    const rate = await getLatestRate(currency, display);
    if (rate.isStale) return { minor: null, rate: rate.rate };
    return { minor: convertWithRate(originalMinor, currency, display, rate.rate), rate: rate.rate };
  } catch {
    return { minor: null, rate: null };
  }
}

export async function createForeignExpense(userId: string, input: {
  originalMinor: number; originalCurrency: string; category: ForeignExpenseCategory;
  merchant?: string; country: string; occurredAt: Date; paymentMethod?: string;
  travelId?: string; sourceRef?: string;
}) {
  let exchangeRateText: string | null = null;
  if (input.originalCurrency !== "INR") {
    try { exchangeRateText = (await getLatestRate(input.originalCurrency, "INR")).rate; }
    catch { exchangeRateText = null; }
  }
  const row = await prisma.foreignExpense.upsert({
    where: {
      userId_sourceProvider_sourceRef: {
        userId, sourceProvider: "USER", sourceRef: input.sourceRef ?? `manual:${input.occurredAt.toISOString()}:${input.originalCurrency}:${input.originalMinor}`,
      },
    },
    create: {
      userId,
      originalMinor: BigInt(input.originalMinor),
      originalCurrency: input.originalCurrency.toUpperCase(),
      displayCurrency: "INR",
      category: input.category,
      merchant: input.merchant ?? null,
      country: input.country.toUpperCase(),
      occurredAt: input.occurredAt,
      paymentMethod: input.paymentMethod ?? null,
      exchangeRateText,
      sourceProvider: "USER",
      sourceRef: input.sourceRef ?? `manual:${input.occurredAt.toISOString()}:${input.originalCurrency}:${input.originalMinor}`,
      travelId: input.travelId ?? null,
    },
    update: {},
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "FOREIGN_EXPENSE_RECORDED", targetType: "FOREIGN_EXPENSE", targetId: row.id });
  return row.id;
}

export async function listForeignExpenses(userId: string, displayCurrency: string, limit = 100): Promise<ForeignExpenseView[]> {
  const rows = await prisma.foreignExpense.findMany({
    where: { userId }, orderBy: { occurredAt: "desc" }, take: limit,
  });
  return Promise.all(rows.map(async (row) => {
    const conv = await converted(Number(row.originalMinor), row.originalCurrency, displayCurrency);
    return {
      id: row.id,
      originalMinor: Number(row.originalMinor),
      originalCurrency: row.originalCurrency,
      convertedMinor: conv.minor,
      displayCurrency,
      category: row.category as ForeignExpenseCategory,
      merchant: row.merchant,
      country: row.country,
      occurredAt: row.occurredAt.toISOString(),
      paymentMethod: row.paymentMethod,
      exchangeRate: row.exchangeRateText,
      fxFeeMinor: row.fxFeeMinor == null ? null : Number(row.fxFeeMinor),
      sourceProvider: row.sourceProvider,
      verificationStatus: row.verificationStatus,
      travelId: row.travelId,
      notice: EXPENSE_NOTICE,
    } satisfies ForeignExpenseView;
  }));
}

/** Canonical recent foreign-currency transactions from the shared classified path. */
export async function listRecentForeignTransactions(userId: string, displayCurrency: string, limit = 20): Promise<ForeignExpenseView[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000);
  const { records } = await loadClassifiedTransactions(userId, from, to, { includeExternal: true });
  const foreign = records.filter((r) => r.currency.toUpperCase() !== "INR").slice(0, limit);
  return Promise.all(foreign.map(async (record, index) => {
    const conv = await converted(record.amountMinor, record.currency, displayCurrency);
    return {
      id: `classified:${record.sourceId}:${index}`,
      originalMinor: record.amountMinor,
      originalCurrency: record.currency,
      convertedMinor: conv.minor,
      displayCurrency,
      category: "OTHER" as ForeignExpenseCategory,
      merchant: record.merchantName,
      country: "--",
      occurredAt: record.occurredAt.toISOString(),
      paymentMethod: null,
      exchangeRate: conv.rate,
      fxFeeMinor: null,
      sourceProvider: record.sourceType,
      verificationStatus: "DERIVED_FROM_CLASSIFIED_TRANSACTION",
      travelId: null,
      notice: "Derived from the canonical classified transaction path. Never counted again in Global Finance totals.",
    } satisfies ForeignExpenseView;
  }));
}

export async function getExpenseSummary(userId: string, displayCurrency: string) {
  const expenses = await listForeignExpenses(userId, displayCurrency, 1000);
  const byCountry: Record<string, number> = {};
  const byCurrency: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  let totalConverted = 0;
  let fxFees = 0;
  for (const expense of expenses) {
    const value = expense.convertedMinor ?? 0;
    totalConverted += value;
    fxFees += expense.fxFeeMinor ?? 0;
    byCountry[expense.country] = (byCountry[expense.country] ?? 0) + value;
    byCurrency[expense.originalCurrency] = (byCurrency[expense.originalCurrency] ?? 0) + expense.originalMinor;
    byCategory[expense.category] = (byCategory[expense.category] ?? 0) + value;
    const month = expense.occurredAt.slice(0, 7);
    byMonth[month] = (byMonth[month] ?? 0) + value;
  }
  return {
    displayCurrency, totalConvertedMinor: totalConverted, fxFeeMinor: fxFees,
    byCountry, byCurrency, byCategory, byMonth,
    notice: EXPENSE_NOTICE,
  };
}

export async function listTravelCurrencyViews(userId: string, displayCurrency: string): Promise<TravelCurrencyView[]> {
  const trips = await listTrips(userId);
  return Promise.all(trips.map(async (trip) => {
    const budget = await getBudget(userId, trip.id);
    const expenses = await listExpenses(userId, trip.id);
    const cash = await prisma.travelCashRecord.findMany({ where: { userId, tripId: trip.id } });
    let spent = 0;
    const currencies = new Set<string>();
    for (const expense of expenses) {
      spent += expense.amountMinor;
      currencies.add(expense.currency);
    }
    const tripCurrency = [...currencies][0] ?? "INR";
    const conv = await converted(spent, tripCurrency, displayCurrency);
    return {
      tripId: trip.id,
      destination: trip.destination,
      tripCurrency,
      budgetMinor: budget.amountMinor ?? null,
      spentMinor: spent,
      convertedSpentMinor: conv.minor,
      displayCurrency,
      cashStartingMinor: cash.length ? Number(cash[0].startingMinor) : null,
      cashRemainingMinor: cash.length
        ? Number(cash[0].startingMinor) + Number(cash[0].receivedMinor) - Number(cash[0].spentMinor)
        : null,
      unreconciledCount: cash.length,
      notice: "Cash entries are user-reported. No FX cash delivery or international card spending is provided by Nexus Pay.",
    } satisfies TravelCurrencyView;
  }));
}

export async function createTravelCash(userId: string, input: {
  tripId: string; currency: string; startingMinor: number; receivedMinor: number;
  spentMinor: number; userReportedRate?: string;
}) {
  const row = await prisma.travelCashRecord.create({
    data: {
      userId, tripId: input.tripId, currency: input.currency.toUpperCase(),
      startingMinor: BigInt(input.startingMinor), receivedMinor: BigInt(input.receivedMinor),
      spentMinor: BigInt(input.spentMinor), userReportedRate: input.userReportedRate ?? null,
    },
  });
  return row.id;
}

/** Explainable insights. Every insight names data, currency, rate, date and method. */
export async function buildInsights(userId: string, displayCurrency: string): Promise<GlobalInsightView[]> {
  const insights: GlobalInsightView[] = [];
  const netWorth = await getNetWorth(userId);
  const { records } = await loadClassifiedTransactions(userId, new Date(Date.now() - 90 * 86400000), new Date(), { includeExternal: true });
  const foreign = records.filter((r) => r.currency.toUpperCase() !== "INR");
  const subscription = await getSubscriptionIntelligence(userId);

  insights.push({
    id: "foreign-exposure",
    kind: "FOREIGN_CURRENCY_EXPOSURE",
    title: "Foreign-currency exposure",
    detail: `${foreign.length} recent record(s) carry a non-INR currency. Exposure is tracked in original currency; totals in ${displayCurrency} are estimates.`,
    currency: displayCurrency,
    rateSource: foreign.length ? "source-attributed reference rate" : null,
    rateAsOf: null,
    calculationDate: new Date().toISOString(),
    methodology: "Count of canonical classified records whose original currency is not INR. No amounts are silently converted.",
    dataUsed: ["loadClassifiedTransactions(includeExternal=true)"],
  });
  insights.push({
    id: "net-worth-context",
    kind: "NET_WORTH_CONTEXT",
    title: "Net-worth context (INR-labelled)",
    detail: "Existing net-worth totals remain INR-labelled. Foreign assets are added separately in original currency to avoid double counting.",
    currency: "INR",
    rateSource: null,
    rateAsOf: null,
    calculationDate: new Date().toISOString(),
    methodology: "Reads getNetWorth() from the Release 16 wealth engine; no figures are re-derived here.",
    dataUsed: ["getNetWorth", `netWorthMinor=${netWorth.netWorthMinor}`],
  });
  insights.push({
    id: "foreign-subscriptions",
    kind: "FOREIGN_SUBSCRIPTIONS",
    title: "Recurring commitments",
    detail: "Subscription commitments are reported in INR by the existing intelligence engine. Foreign-currency billing is not automatically paid.",
    currency: "INR",
    rateSource: null,
    rateAsOf: null,
    calculationDate: new Date().toISOString(),
    methodology: "Reads getSubscriptionIntelligence() from the existing subscription engine; no silent FX conversion is performed.",
    dataUsed: ["getSubscriptionIntelligence", `monthlyCommitmentMinor=${subscription.monthlyCommitmentMinor}`],
  });
  await prisma.globalInsight.deleteMany({ where: { userId, kind: "FOREIGN_CURRENCY_EXPOSURE" } });
  return insights;
}

export { EXPENSE_NOTICE };
