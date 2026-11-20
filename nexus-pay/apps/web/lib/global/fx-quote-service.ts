/**
 * Release 18 — FX quote lifecycle.
 *
 * A quote is a PRESENTATION and PLANNING artifact. Executable quotes require a
 * verified, authorized conversion counterparty; none is configured. Confirming
 * a quote therefore records customer acknowledgement only and never moves money.
 */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type { FxQuoteState, FxQuoteView, RateClassification } from "@nexus/shared-types";
import { assertCurrencyPair, convertWithRate } from "@/lib/global/currency-service";
import { getLatestRate } from "@/lib/global/fx-service";
import { notifyGlobal, recordGlobalAudit, publishGlobalSecurity } from "@/lib/global/global-audit";

const QUOTE_NOTICE =
  "Indicative quote built from a reference rate. It is NOT an executable exchange rate. No currency conversion, debit or wallet settlement is performed by Nexus Pay. Fees and taxes are not included unless a verified provider quote supplies them.";

function toView(row: {
  id: string; state: string; sourceCurrency: string; targetCurrency: string;
  sourceMinor: bigint; targetMinor: bigint | null; rateText: string | null;
  classification: string; providerCode: string; providerFeeMinor: bigint | null;
  taxMinor: bigint | null; expiresAt: Date | null; providerRef: string | null;
  payableMinor: bigint | null; receivableMinor: bigint | null;
}): FxQuoteView {
  const expired = row.expiresAt && row.expiresAt.getTime() < Date.now() && row.state !== "COMPLETED";
  const state = (expired ? "QUOTE_EXPIRED" : row.state) as FxQuoteState;
  return {
    id: row.id,
    state,
    sourceCurrency: row.sourceCurrency,
    targetCurrency: row.targetCurrency,
    sourceMinor: Number(row.sourceMinor),
    targetMinor: row.targetMinor == null ? null : Number(row.targetMinor),
    rate: row.rateText,
    classification: row.classification as RateClassification,
    providerCode: row.providerCode,
    providerFeeMinor: row.providerFeeMinor == null ? null : Number(row.providerFeeMinor),
    taxMinor: row.taxMinor == null ? null : Number(row.taxMinor),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    providerRef: row.providerRef,
    payableMinor: row.payableMinor == null ? null : Number(row.payableMinor),
    receivableMinor: row.receivableMinor == null ? null : Number(row.receivableMinor),
    notice: QUOTE_NOTICE,
  };
}

/** Builds an indicative quote from a persisted, source-attributed reference rate. */
export async function requestQuote(userId: string, input: {
  from: string; to: string; amountMinor: number; providerCode?: string;
}) {
  assertCurrencyPair(input.from, input.to);
  const rate = await getLatestRate(input.from, input.to);
  const targetMinor = convertWithRate(input.amountMinor, input.from, input.to, rate.rate);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const row = await prisma.fxQuote.create({
    data: {
      userId,
      state: "CUSTOMER_CONFIRMATION_REQUIRED",
      sourceCurrency: input.from.toUpperCase(),
      targetCurrency: input.to.toUpperCase(),
      sourceMinor: BigInt(input.amountMinor),
      targetMinor: BigInt(targetMinor),
      rateText: rate.rate,
      classification: rate.classification,
      providerCode: rate.providerCode,
      expiresAt,
    },
  });
  await notifyGlobal(userId, "GLOBAL_FX_QUOTE_READY", "Indicative conversion quote ready", QUOTE_NOTICE, {
    quoteId: row.id, pair: `${input.from}/${input.to}`,
  });
  return toView(row);
}

export async function getQuote(userId: string, id: string): Promise<FxQuoteView> {
  const row = await prisma.fxQuote.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Quote not found");
  return toView(row);
}

export async function listQuotes(userId: string, limit = 20): Promise<FxQuoteView[]> {
  const rows = await prisma.fxQuote.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map(toView);
}

/**
 * Records explicit customer confirmation for planning. NO execution is attempted
 * because no verified executable provider is configured.
 */
export async function confirmQuote(userId: string, id: string) {
  const row = await prisma.fxQuote.findFirst({ where: { id, userId } });
  if (!row) throw new ApiError(404, "VALIDATION_ERROR", "Quote not found");
  const expired = row.expiresAt && row.expiresAt.getTime() < Date.now();
  if (expired) throw new ApiError(409, "VALIDATION_ERROR", "Quote has expired; request a new indicative quote");
  const confirmation = {
    confirmedAt: new Date().toISOString(),
    executed: false,
    reason: "No verified executable FX provider is configured. Quote is for planning only.",
  };
  const updated = await prisma.fxQuote.update({
    where: { id },
    data: { confirmation: confirmation as object },
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "FX_QUOTE_CONFIRMED_PLANNING_ONLY", targetType: "FX_QUOTE", targetId: id, metadata: confirmation });
  await publishGlobalSecurity({ type: "GLOBAL_FX_CONVERSION_VIEWED", actorId: userId, subjectId: userId, transactionRef: id });
  return toView(updated);
}

/** Worker entry: expire unconfirmed quotes. Never executes anything. */
export async function expireQuotes(): Promise<number> {
  const result = await prisma.fxQuote.updateMany({
    where: {
      state: { in: ["QUOTE_RECEIVED", "CUSTOMER_CONFIRMATION_REQUIRED"] },
      expiresAt: { lt: new Date() },
    },
    data: { state: "QUOTE_EXPIRED" },
  });
  if (result.count) {
    const rows = await prisma.fxQuote.findMany({
      where: { state: "QUOTE_EXPIRED" }, select: { userId: true, id: true }, take: result.count,
    });
    for (const row of rows) {
      await notifyGlobal(row.userId, "GLOBAL_FX_QUOTE_EXPIRED", "Indicative quote expired", QUOTE_NOTICE, { quoteId: row.id });
    }
  }
  return result.count;
}
