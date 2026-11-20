/**
 * Release 18 — multi-currency account tracking.
 *
 * Reuses `listAccounts` from the existing aggregation layer. Imported accounts
 * are never duplicated: a verified row with a sourceRef matching an existing
 * connection is suppressed. Original currency and amount are always preserved.
 */
import { prisma } from "@nexus/database";
import { ApiError } from "@/lib/api/response";
import type { AccountClassification, ForeignAssetLiabilityView, MultiCurrencyAccountView } from "@nexus/shared-types";
import { listAccounts } from "@/lib/accounts/accounts-service";
import { convertWithRate } from "@/lib/global/currency-service";
import { getLatestRate } from "@/lib/global/fx-service";
import { recordGlobalAudit } from "@/lib/global/global-audit";

const UNVERIFIED_NOTICE =
  "User-reported balance. Not independently verified. The original currency and amount are preserved; the converted value is an estimate at a stated reference rate and is not a wallet balance.";

async function toDisplayMinor(originalMinor: number, currency: string, displayCurrency: string): Promise<number | null> {
  if (currency === displayCurrency) return originalMinor;
  try {
    const rate = await getLatestRate(currency, displayCurrency);
    if (rate.isStale) return null;
    return convertWithRate(originalMinor, currency, displayCurrency, rate.rate);
  } catch {
    return null; // no rate → do not fabricate a converted value
  }
}

export async function listGlobalAccounts(userId: string, displayCurrency: string): Promise<MultiCurrencyAccountView[]> {
  const external = await listAccounts(userId);
  const reported = await prisma.globalAccount.findMany({ where: { userId }, orderBy: { name: "asc" } });

  // De-duplicate by provider + source reference against already-imported accounts.
  const importedTags = new Set(
    external.filter((a) => !a.isWallet).map((a) => `${a.providerName}:${a.maskedIdentifier}`),
  );

  const views: MultiCurrencyAccountView[] = await Promise.all(external.map(async (account) => ({
    id: `external:${account.id}`,
    name: account.institutionName || account.maskedIdentifier,
    providerCode: account.providerName,
    accountType: account.accountType,
    currency: account.currency,
    originalBalanceMinor: account.balanceMinor ?? 0,
    displayBalanceMinor: account.balanceMinor == null
      ? null
      : await toDisplayMinor(account.balanceMinor, account.currency, displayCurrency),
    displayCurrency,
    classification: (account.isSandbox ? "SANDBOX_DATA" : "VERIFIED_PROVIDER_DATA") as AccountClassification,
    verificationStatus: account.isSandbox ? "SANDBOX" : "VERIFIED",
    connectionStatus: account.status,
    sourceRef: account.maskedIdentifier,
    lastSyncedAt: account.lastSyncAt,
    isWallet: account.isWallet,
    notice: account.isWallet
      ? "Nexus Pay wallet. INR is the only transactable wallet currency; balances are read live from Raftline."
      : "Provider-reported balance. Conversion shown only where a source-attributed, non-stale rate exists.",
  })));

  for (const row of reported) {
    if (row.classification === "VERIFIED_PROVIDER_DATA" && importedTags.has(`${row.providerCode}:${row.sourceRef}`)) continue;
    const original = Number(row.originalBalanceMinor);
    views.push({
      id: row.id,
      name: row.name,
      providerCode: row.providerCode,
      accountType: row.accountType,
      currency: row.currency,
      originalBalanceMinor: original,
      displayBalanceMinor: await toDisplayMinor(original, row.currency, displayCurrency),
      displayCurrency,
      classification: row.classification as AccountClassification,
      verificationStatus: row.verificationStatus,
      connectionStatus: row.connectionStatus,
      sourceRef: row.sourceRef,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      isWallet: row.isWallet,
      notice: UNVERIFIED_NOTICE,
    });
  }
  return views;
}

export async function createGlobalAccount(userId: string, input: {
  name: string; providerCode: string; accountType: string; currency: string;
  originalBalanceMinor: number; classification?: AccountClassification; sourceRef?: string; note?: string;
}) {
  const classification = input.classification ?? "USER_REPORTED";
  const row = await prisma.globalAccount.create({
    data: {
      userId,
      name: input.name,
      providerCode: input.providerCode,
      accountType: input.accountType,
      currency: input.currency.toUpperCase(),
      originalBalanceMinor: BigInt(input.originalBalanceMinor),
      classification,
      verificationStatus: classification === "USER_REPORTED" ? "UNVERIFIED" : "PROVIDER_REPORTED",
      connectionStatus: "ACTIVE",
      sourceRef: input.sourceRef ?? null,
      isWallet: false,
    },
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "GLOBAL_ACCOUNT_CREATED", targetType: "GLOBAL_ACCOUNT", targetId: row.id });
  return row.id;
}

export async function deleteGlobalAccount(userId: string, id: string) {
  const result = await prisma.globalAccount.deleteMany({ where: { id, userId, isWallet: false } });
  if (!result.count) throw new ApiError(404, "VALIDATION_ERROR", "Account not found");
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "GLOBAL_ACCOUNT_DELETED", targetType: "GLOBAL_ACCOUNT", targetId: id });
}

export async function captureBalanceSnapshots(): Promise<number> {
  const accounts = await prisma.globalAccount.findMany({ where: { connectionStatus: "ACTIVE" } });
  for (const account of accounts) {
    await prisma.globalBalanceSnapshot.create({
      data: {
        accountId: account.id, userId: account.userId,
        balance: account.originalBalanceMinor, currency: account.currency,
        sourceRef: account.sourceRef,
      },
    });
  }
  return accounts.length;
}

async function assetView(row: {
  id: string; kind: string; label: string; originalMinor: bigint; originalCurrency: string;
  valuationDate: Date; rateText: string | null; rateSource: string | null; verificationStatus: string;
  sourceRef: string | null;
}, displayCurrency: string): Promise<ForeignAssetLiabilityView> {
  const original = Number(row.originalMinor);
  let converted: number | null = null;
  if (row.rateText && row.originalCurrency === displayCurrency) converted = original;
  else if (row.rateText) {
    try { converted = convertWithRate(original, row.originalCurrency, displayCurrency, row.rateText); }
    catch { converted = null; }
  }
  return {
    id: row.id,
    kind: row.kind as "ASSET" | "LIABILITY",
    label: row.label,
    originalMinor: original,
    originalCurrency: row.originalCurrency,
    convertedMinor: converted,
    displayCurrency,
    valuationDate: row.valuationDate.toISOString(),
    rate: row.rateText,
    rateSource: row.rateSource,
    verificationStatus: row.verificationStatus,
    sourceRef: row.sourceRef,
    notice: "Original-currency value is preserved. Converted value uses the recorded valuation rate; it is not a current market quote and is not a wallet balance.",
  };
}

export async function listAssetsLiabilities(userId: string, displayCurrency: string): Promise<ForeignAssetLiabilityView[]> {
  const rows = await prisma.foreignAssetLiability.findMany({ where: { userId }, orderBy: { valuationDate: "desc" } });
  return Promise.all(rows.map((row) => assetView(row, displayCurrency)));
}

export async function createAssetLiability(userId: string, input: {
  kind: "ASSET" | "LIABILITY"; label: string; originalMinor: number; originalCurrency: string;
  valuationDate: Date; sourceRef?: string; note?: string;
}) {
  // Record the source-attributed rate at valuation time where one is available.
  let rateText: string | null = null;
  let rateSource: string | null = null;
  if (input.originalCurrency !== "INR") {
    try {
      const rate = await getLatestRate(input.originalCurrency, "INR");
      rateText = rate.rate;
      rateSource = rate.providerCode;
    } catch { /* no rate → keep original value only */ }
  } else {
    rateText = "1";
    rateSource = "IDENTITY";
  }
  const row = await prisma.foreignAssetLiability.create({
    data: {
      userId,
      kind: input.kind,
      label: input.label,
      originalMinor: BigInt(input.originalMinor),
      originalCurrency: input.originalCurrency.toUpperCase(),
      valuationDate: input.valuationDate,
      rateText,
      rateSource,
      verificationStatus: "USER_REPORTED",
      sourceRef: input.sourceRef ?? null,
    },
  });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "FOREIGN_VALUATION_CREATED", targetType: "FOREIGN_ASSET_LIABILITY", targetId: row.id, metadata: { kind: input.kind } });
  return row.id;
}

export async function deleteAssetLiability(userId: string, id: string) {
  const result = await prisma.foreignAssetLiability.deleteMany({ where: { id, userId } });
  if (!result.count) throw new ApiError(404, "VALIDATION_ERROR", "Record not found");
}
