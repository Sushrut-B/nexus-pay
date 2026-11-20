/** Release 18 — global dashboard and Nexus Control operational views. */
import { prisma } from "@nexus/database";
import type { GlobalDashboardView } from "@nexus/shared-types";
import { resolveDisplayCurrency } from "@/lib/global/currency-service";
import { listRecentRates } from "@/lib/global/fx-service";
import { listGlobalAccounts, listAssetsLiabilities } from "@/lib/global/global-accounts-service";
import { listRecentForeignTransactions, getExpenseSummary, listTravelCurrencyViews } from "@/lib/global/global-expenses-service";
import { listAlerts } from "@/lib/global/watchlist-service";
import { listTransfers } from "@/lib/global/international-payment-service";
import { ensureFxProviderRecords, listFxProviders } from "@/lib/global/providers";
import { ensureInternationalRecords, listInternationalProviders } from "@/lib/global/providers/international-index";
import { notifyGlobal, recordGlobalAudit, publishGlobalSecurity } from "@/lib/global/global-audit";

const DASHBOARD_NOTICE =
  "Converted values are estimates at source-attributed reference rates and are not wallet balances. INR remains the only transactable Nexus Pay wallet currency. No FX execution or international settlement is performed.";

export async function getDisplayCurrency(userId: string): Promise<string> {
  const pref = await prisma.globalUserPreference.findUnique({ where: { userId } });
  return pref?.displayCurrency ?? resolveDisplayCurrency();
}

export async function setDisplayCurrency(userId: string, currency: string) {
  const row = await prisma.globalUserPreference.upsert({
    where: { userId },
    create: { userId, displayCurrency: currency },
    update: { displayCurrency: currency },
  });
  await publishGlobalSecurity({ type: "GLOBAL_DISPLAY_CURRENCY_CHANGED", actorId: userId, subjectId: userId, metadata: { currency } });
  await recordGlobalAudit({ actorType: "USER", actorId: userId, action: "DISPLAY_CURRENCY_CHANGED", targetType: "GLOBAL_USER_PREFERENCE", targetId: row.id, metadata: { currency } });
  return row.displayCurrency;
}

export async function getDashboard(userId: string, requestedCurrency?: string): Promise<GlobalDashboardView> {
  const displayCurrency = requestedCurrency ? resolveDisplayCurrency(requestedCurrency) : await getDisplayCurrency(userId);
  const [
    accounts, recentForeign, rates, alerts, transfers, assets, expenseSummary, travel,
  ] = await Promise.all([
    listGlobalAccounts(userId, displayCurrency),
    listRecentForeignTransactions(userId, displayCurrency, 10),
    listRecentRates(6),
    listAlerts(userId),
    listTransfers(userId, 5),
    listAssetsLiabilities(userId, displayCurrency),
    getExpenseSummary(userId, displayCurrency),
    listTravelCurrencyViews(userId, displayCurrency),
  ]);

  const assetExposure = assets.filter((a) => a.kind === "ASSET").reduce((sum, a) => sum + (a.convertedMinor ?? 0), 0);
  const liabilityExposure = assets.filter((a) => a.kind === "LIABILITY").reduce((sum, a) => sum + (a.convertedMinor ?? 0), 0);
  const walletAndAccounts = accounts.reduce((sum, a) => sum + (a.displayBalanceMinor ?? 0), 0);
  const totalAssetsMinor = walletAndAccounts + assetExposure;

  const allocationMap = new Map<string, number>();
  for (const account of accounts) {
    allocationMap.set(account.currency, (allocationMap.get(account.currency) ?? 0) + account.originalBalanceMinor);
  }
  const allocationTotal = [...allocationMap.values()].reduce((a, b) => a + b, 0) || 1;
  const currencyAllocation = [...allocationMap.entries()]
    .map(([currency, minor]) => ({ currency, minor, percentBps: Math.round((minor / allocationTotal) * 10000) }))
    .sort((a, b) => b.minor - a.minor);

  const travelSpend = travel.reduce((sum, t) => sum + (t.convertedSpentMinor ?? 0), 0);

  return {
    displayCurrency,
    totalAssetsMinor,
    foreignAssetExposureMinor: assetExposure,
    foreignLiabilityExposureMinor: liabilityExposure,
    recentInternationalExpenseMinor: expenseSummary.totalConvertedMinor,
    recentTravelSpendMinor: travelSpend,
    recentMovements: rates,
    recentForeignTransactions: recentForeign,
    accounts,
    alerts,
    pendingTransfers: transfers.filter((t) => !["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"].includes(t.state)),
    currencyAllocation,
    generatedAt: new Date().toISOString(),
    notice: DASHBOARD_NOTICE,
  };
}

export async function getOperations() {
  await ensureFxProviderRecords();
  await ensureInternationalRecords();
  const [fxProviders, intlProviders, jobs, webhooks, reconciliations, compliance, audit] = await Promise.all([
    listFxProviders(),
    listInternationalProviders(),
    prisma.fxSyncJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.internationalPaymentWebhook.findMany({ orderBy: { receivedAt: "desc" }, take: 50 }),
    prisma.internationalReconciliation.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.internationalComplianceCheck.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.globalAuditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const rateRows = await prisma.fxRate.findMany({ orderBy: { fetchedAt: "desc" }, take: 5 });
  return {
    fxProviders,
    internationalProviders: intlProviders,
    rateFreshness: rateRows.map((r) => ({
      pair: `${r.baseCurrency}/${r.quoteCurrency}`,
      provider: r.providerCode,
      classification: r.classification,
      asOf: r.asOf.toISOString(),
      fetchedAt: r.fetchedAt.toISOString(),
    })),
    jobs: jobs.map((j) => ({
      id: j.id, kind: j.kind, status: j.status, attempts: j.attempts,
      providerCode: j.providerCode, lastError: j.lastError,
      nextAttemptAt: j.nextAttemptAt?.toISOString() ?? null,
    })),
    failedJobs: jobs.filter((j) => j.status === "FAILED").length,
    webhooks: webhooks.map((w) => ({
      id: w.id, providerCode: w.providerCode, eventId: w.eventId,
      signatureVerified: w.signatureVerified, processed: w.processed,
      lastError: w.lastError, receivedAt: w.receivedAt.toISOString(),
    })),
    reconciliations: reconciliations.map((r) => ({
      id: r.id, transferId: r.transferId, providerRef: r.providerRef,
      outcome: r.outcome, resolvedBy: r.resolvedBy, createdAt: r.createdAt.toISOString(),
    })),
    compliance: compliance.map((c) => ({
      id: c.id, kind: c.kind, state: c.state, transferId: c.transferId,
      createdAt: c.createdAt.toISOString(),
    })),
    audit: audit.map((a) => ({
      id: a.id, action: a.action, actorId: a.actorId, targetType: a.targetType,
      targetId: a.targetId, createdAt: a.createdAt.toISOString(),
    })),
    notice: DASHBOARD_NOTICE,
  };
}

/** Control action: pause an unhealthy provider. No balance/rate/transfer override. */
export async function pauseProvider(actorId: string, kind: "fx" | "international", code: string, paused: boolean) {
  if (kind === "fx") {
    const result = await prisma.fxProvider.updateMany({ where: { code }, data: { paused } });
    if (!result.count) throw new Error("Provider not found");
  } else {
    const result = await prisma.internationalProvider.updateMany({ where: { code }, data: { paused } });
    if (!result.count) throw new Error("Provider not found");
  }
  await recordGlobalAudit({ actorType: "ADMIN", actorId, action: paused ? "PROVIDER_PAUSED" : "PROVIDER_RESUMED", targetType: kind === "fx" ? "FX_PROVIDER" : "INTERNATIONAL_PROVIDER", targetId: code });
  await publishGlobalSecurity({ type: "GLOBAL_PROVIDER_CONFIG_CHANGED", actorId, metadata: { kind, code, paused } });
}

/** Control action: retry an eligible READ-ONLY sync job. Never retries a transfer. */
export async function retryReadOnlyJob(actorId: string, jobId: string) {
  const job = await prisma.fxSyncJob.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("Job not found");
  if (!["RATE_SYNC", "HISTORICAL_RATE_SYNC", "VALUATION_SNAPSHOT", "ALERT_EVALUATION"].includes(job.kind)) {
    throw new Error("Only read-only synchronization jobs are eligible for retry");
  }
  const updated = await prisma.fxSyncJob.update({
    where: { id: jobId },
    data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date(), leaseUntil: null },
  });
  await recordGlobalAudit({ actorType: "ADMIN", actorId, action: "READ_ONLY_JOB_RETRIED", targetType: "FX_SYNC_JOB", targetId: jobId });
  return updated;
}

export { DASHBOARD_NOTICE, notifyGlobal };
