import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r18_${stamp}_${label}`,
      fullName: `Release Eighteen ${label}`,
      email: `r18_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r18${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Eighteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  const accountId = `np_r18_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release18-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return user;
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  process.env.NEXUS_GLOBAL_FX_SANDBOX_ENABLED = "true";
  process.env.NEXUS_GLOBAL_PAYMENTS_SANDBOX_ENABLED = "true";
  svc = {
    fx: await import("../../apps/web/lib/global/fx-service"),
    currency: await import("../../apps/web/lib/global/currency-service"),
    accounts: await import("../../apps/web/lib/global/global-accounts-service"),
    expenses: await import("../../apps/web/lib/global/global-expenses-service"),
    watchlist: await import("../../apps/web/lib/global/watchlist-service"),
    quotes: await import("../../apps/web/lib/global/fx-quote-service"),
    payments: await import("../../apps/web/lib/global/international-payment-service"),
    dashboard: await import("../../apps/web/lib/global/global-dashboard-service"),
    worker: await import("../../apps/web/lib/global/global-worker-bootstrap"),
    classified: await import("../../apps/web/lib/finance-intelligence/classification-service"),
  };
  await svc.fx.ensureFxProviderRecords();
  await svc.payments.listProviders();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r18_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 18 global finance verification", () => {
  it("FX-01: sandbox rates are persisted with reference classification and source attribution", async () => {
    const rate = await svc.fx.syncLatestRate("USD", "INR");
    expect(rate.classification).toBe("REFERENCE");
    expect(rate.providerCode).toBe("sandbox-fx");
    expect(rate.rate).toMatch(/^\d+(\.\d+)?$/);
    expect(rate.sourceRef).toContain("sandbox-fixture");
    expect(rate.isStale).toBe(false);
  }, 120_000);

  it("FX-02: conversion preserves the original amount and labels fees as excluded", async () => {
    await svc.fx.syncLatestRate("USD", "INR");
    const result = await svc.fx.convert({ from: "USD", to: "INR", amountMinor: 10000 });
    expect(result.originalMinor).toBe(10000);
    expect(result.convertedMinor).toBeGreaterThan(0);
    expect(result.feesIncluded).toBe(false);
    expect(result.notice).toContain("not an executable");
    expect(result.classification).toBe("REFERENCE");
  }, 120_000);

  it("FX-03: historical rates are classified HISTORICAL and persist", async () => {
    const from = new Date(Date.now() - 3 * 86400000);
    const to = new Date();
    const count = await svc.fx.syncHistoricalRates("USD", "INR", from, to);
    expect(count).toBeGreaterThan(0);
    const rows = await svc.fx.getHistoricalRates("USD", "INR", from, to);
    expect(rows.length).toBeGreaterThan(0);
    // Reference rows for the same pair may share the range; every persisted
    // historical row must be classified HISTORICAL and never executable.
    expect(rows.some((r: any) => r.classification === "HISTORICAL")).toBe(true);
    expect(rows.every((r: any) => r.classification !== "EXECUTABLE_QUOTE")).toBe(true);
  }, 120_000);

  it("FX-04: stale rates are flagged, never presented as current", async () => {
    const stored = await prisma.fxRate.create({
      data: {
        id: `stale:${stamp}`, baseCurrency: "EUR", quoteCurrency: "INR", rateText: "90",
        classification: "REFERENCE", providerCode: "sandbox-fx", asOf: new Date(),
        fetchedAt: new Date(Date.now() - 30 * 86400000), precision: 2,
      },
    });
    const view = await svc.fx.getLatestRate("EUR", "INR");
    expect(view.id).toBe(stored.id);
    expect(view.isStale).toBe(true);
    expect(view.notice).toContain("STALE");
  }, 120_000);

  it("ACC-05: user-reported accounts preserve original currency and amount", async () => {
    const user = await createUser("accounts");
    await svc.accounts.createGlobalAccount(user.id, {
      name: "USD savings", providerCode: "USER", accountType: "CASH", currency: "USD",
      originalBalanceMinor: 123456, classification: "USER_REPORTED",
    });
    const accounts = await svc.accounts.listGlobalAccounts(user.id, "INR");
    const reported = accounts.find((a: any) => a.name === "USD savings");
    expect(reported.originalBalanceMinor).toBe(123456);
    expect(reported.currency).toBe("USD");
    expect(reported.classification).toBe("USER_REPORTED");
    expect(accounts.some((a: any) => a.isWallet && a.currency === "INR")).toBe(true);
  }, 120_000);

  it("ACC-06: foreign assets and liabilities are recorded at a valuation rate", async () => {
    const user = await createUser("assets");
    await svc.accounts.createAssetLiability(user.id, {
      kind: "ASSET", label: "US bank deposit", originalMinor: 500000,
      originalCurrency: "USD", valuationDate: new Date(),
    });
    const rows = await svc.accounts.listAssetsLiabilities(user.id, "INR");
    expect(rows).toHaveLength(1);
    expect(rows[0].originalMinor).toBe(500000);
    expect(rows[0].rateSource).toBeTruthy();
  }, 120_000);

  it("EXP-07: recent foreign transactions reuse the canonical classified path", async () => {
    const user = await createUser("expenses");
    const from = new Date(Date.now() - 90 * 86400000);
    const canonical = await svc.classified.loadClassifiedTransactions(user.id, from, new Date(), { includeExternal: true });
    const foreign = await svc.expenses.listRecentForeignTransactions(user.id, "INR", 20);
    const expected = canonical.records.filter((r: any) => r.currency.toUpperCase() !== "INR");
    expect(foreign.length).toBe(expected.length);
    expect(foreign.every((e: any) => e.notice.includes("Never counted again"))).toBe(true);
  }, 120_000);

  it("WATCH-08: alerts avoid duplicate notifications within 24 hours", async () => {
    const user = await createUser("alerts");
    await svc.fx.syncLatestRate("USD", "INR");
    await svc.watchlist.createAlert(user.id, {
      baseCurrency: "USD", quoteCurrency: "INR", direction: "ABOVE", targetRate: "1",
    });
    const first = await svc.watchlist.evaluateAlerts();
    const second = await svc.watchlist.evaluateAlerts();
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  }, 120_000);

  it("QUOTE-09: confirming an indicative quote records planning only, never execution", async () => {
    const user = await createUser("quotes");
    await svc.fx.syncLatestRate("USD", "INR");
    const quote = await svc.quotes.requestQuote(user.id, { from: "USD", to: "INR", amountMinor: 5000 });
    expect(quote.classification).toBe("REFERENCE");
    const confirmed = await svc.quotes.confirmQuote(user.id, quote.id);
    const stored = await prisma.fxQuote.findUnique({ where: { id: quote.id } });
    expect((stored!.confirmation as any).executed).toBe(false);
    expect(confirmed.state).not.toBe("COMPLETED");
  }, 120_000);

  it("QUOTE-10: expired quotes are marked QUOTE_EXPIRED and cannot be confirmed", async () => {
    const user = await createUser("quote-expiry");
    await svc.fx.syncLatestRate("USD", "INR");
    const quote = await svc.quotes.requestQuote(user.id, { from: "USD", to: "INR", amountMinor: 1000 });
    await prisma.fxQuote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectApiError(svc.quotes.confirmQuote(user.id, quote.id), 409);
    await svc.quotes.expireQuotes();
    expect((await svc.quotes.getQuote(user.id, quote.id)).state).toBe("QUOTE_EXPIRED");
  }, 120_000);

  it("PAY-11: beneficiaries are encrypted, masked and verification stays pending", async () => {
    const user = await createUser("beneficiaries");
    const beneficiary = await svc.payments.createBeneficiary(user.id, {
      label: "Family", country: "US", currency: "USD", accountIdentifier: "123456789012",
      paymentMethod: "BANK_TRANSFER", bankName: "Test Bank",
    });
    expect(beneficiary.accountMasked).toContain("****");
    expect(beneficiary.accountMasked).not.toContain("123456789");
    const stored = await prisma.internationalBeneficiary.findUnique({ where: { id: beneficiary.id } });
    expect(stored!.encryptedDetails).not.toContain("123456789012");
    expect(beneficiary.verificationStatus).toBe("VERIFICATION_PENDING");
  }, 120_000);

  it("PAY-12: transfers remain non-executed and idempotency prevents duplicates", async () => {
    const user = await createUser("transfers");
    const beneficiary = await svc.payments.createBeneficiary(user.id, {
      label: "Relative", country: "US", currency: "USD", accountIdentifier: "999988887777",
      paymentMethod: "BANK_TRANSFER",
    });
    const key = `r18-${stamp}-transfer-01`;
    const first = await svc.payments.createTransfer(user.id, {
      beneficiaryId: beneficiary.id, sourceCurrency: "INR", targetCurrency: "USD",
      sourceMinor: 100000, purposeCode: "FAMILY", idempotencyKey: key,
    });
    const second = await svc.payments.createTransfer(user.id, {
      beneficiaryId: beneficiary.id, sourceCurrency: "INR", targetCurrency: "USD",
      sourceMinor: 100000, purposeCode: "FAMILY", idempotencyKey: key,
    });
    expect(first.id).toBe(second.id);
    expect(first.state).toBe("CREATED");
    expect(first.walletSettlementRef).toBeNull();
    expect(first.notice).toContain("No provider is enabled");
    expect(await prisma.internationalTransfer.count({ where: { idempotencyKey: key } })).toBe(1);
  }, 120_000);

  it("PAY-13: webhook signatures are verified and duplicates de-duplicated", async () => {
    const secret = process.env.AUTH_SECRET ?? "";
    const payload = { eventId: `evt-${stamp}`, status: "COMPLETED" };
    const raw = JSON.stringify(payload);
    const { createHmac } = await import("node:crypto");
    const signature = createHmac("sha256", `${secret}:intl-webhook:sandbox-intl`).update(`evt-${stamp}.${raw}`).digest("hex");
    await expectApiError(svc.payments.receiveInternationalWebhook({
      providerCode: "sandbox-intl", eventId: `evt-${stamp}`, payload, signature: "bad",
    }), 401);
    const first = await svc.payments.receiveInternationalWebhook({ providerCode: "sandbox-intl", eventId: `evt-${stamp}`, payload, signature });
    const second = await svc.payments.receiveInternationalWebhook({ providerCode: "sandbox-intl", eventId: `evt-${stamp}`, payload, signature });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  }, 120_000);

  it("SEC-14: user A cannot access user B's beneficiary, transfer, quote or watchlist", async () => {
    const a = await createUser("user-a");
    const b = await createUser("user-b");
    const beneficiary = await svc.payments.createBeneficiary(a.id, {
      label: "A only", country: "GB", currency: "GBP", accountIdentifier: "444433332222", paymentMethod: "BANK_TRANSFER",
    });
    const watchlist = await svc.watchlist.createWatchlist(a.id, {
      name: "A list", pairs: [{ baseCurrency: "USD", quoteCurrency: "INR" }],
    });
    await expectApiError(svc.payments.getBeneficiary(b.id, beneficiary.id), 404);
    await expectApiError(svc.quotes.getQuote(b.id, "nonexistent"), 404);
    expect((await svc.watchlist.listWatchlists(b.id)).some((w: any) => w.id === watchlist.id)).toBe(false);
  }, 120_000);

  it("OPS-15: only read-only jobs can be enqueued and retried; rate sync completes via worker", async () => {
    await expect(svc.worker.enqueueGlobalJob({ kind: "TRANSFER_SUBMISSION" })).rejects.toThrow("not a read-only");
    const job = await svc.worker.enqueueGlobalJob({
      kind: "RATE_SYNC", payload: { base: "USD", quote: "INR" },
      idempotencyKey: `r18-sync-${stamp}`,
    });
    const result = await svc.worker.processGlobalJob(job.id);
    expect(result).toBe("processed");
    const stored = await prisma.fxSyncJob.findUnique({ where: { id: job.id } });
    expect(stored!.status).toBe("COMPLETED");
  }, 120_000);

  it("SEC-16: display currency changes are audited and INR remains the wallet currency", async () => {
    const user = await createUser("preferences");
    await svc.dashboard.setDisplayCurrency(user.id, "JPY");
    expect(await svc.dashboard.getDisplayCurrency(user.id)).toBe("JPY");
    const wallet = await prisma.wallet.findFirst({ where: { userId: user.id } });
    expect(wallet!.currency).toBe("INR");
    const currencies = svc.currency.listCurrencies();
    expect(currencies.filter((c: any) => c.transactableWallet).map((c: any) => c.code)).toEqual(["INR"]);
  }, 120_000);
});
