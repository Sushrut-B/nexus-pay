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
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r16_${stamp}_${label}`,
      fullName: `Release Sixteen ${label}`,
      email: `r16_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r16${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Sixteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r16_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release16-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return user;
}

async function connectAndSync(userId: string) {
  const initiated = await svc.connections.initiateConnection(userId, { providerCode: "sandbox-investments", displayName: "Test portfolio" });
  await svc.connections.completeConnection(userId, initiated.id);
  await svc.sync.runInvestmentSyncWorker(25);
  return initiated.id;
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    bootstrap: await import("../../apps/web/lib/investments/investment-worker-bootstrap"),
    connections: await import("../../apps/web/lib/investments/connection-service"),
    sync: await import("../../apps/web/lib/investments/sync-service"),
    portfolio: await import("../../apps/web/lib/investments/portfolio-service"),
    wealth: await import("../../apps/web/lib/investments/wealth-service"),
    planning: await import("../../apps/web/lib/investments/planning-service"),
    discovery: await import("../../apps/web/lib/investments/discovery-service"),
    documents: await import("../../apps/web/lib/investments/document-service"),
    control: await import("../../apps/web/lib/investments/investment-control-service"),
  };
  await svc.bootstrap.ensureInvestmentConfiguration();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r16_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 16 investments verification", () => {
  it("INV-01: provider is sandbox-only with explicit capabilities", async () => {
    const provider = await prisma.investmentProvider.findFirst({ where: { status: "AVAILABLE" } });
    expect(provider?.mode).toBe("SANDBOX");
    const caps = await prisma.investmentProviderCapability.count({ where: { providerId: provider!.id, enabled: true } });
    expect(caps).toBeGreaterThan(5);
  }, 120_000);

  it("CON-02: connection lifecycle creates consent and imports holdings", async () => {
    const user = await createUser("connect");
    const connectionId = await connectAndSync(user.id);
    const connection = await prisma.investmentConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { consents: true } });
    expect(connection.status).toBe("ACTIVE");
    expect(connection.consents[0]?.status).toBe("ACTIVE");
    expect(await prisma.investmentHolding.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    expect(await prisma.investmentTransaction.count({ where: { userId: user.id } })).toBeGreaterThan(0);
    expect(await prisma.sIPTrackingRecord.count({ where: { userId: user.id } })).toBeGreaterThan(0);
  }, 120_000);

  it("SYNC-03: repeated synchronization does not duplicate holdings or transactions", async () => {
    const user = await createUser("dedupe");
    const connectionId = await connectAndSync(user.id);
    const before = {
      holdings: await prisma.investmentHolding.count({ where: { userId: user.id } }),
      transactions: await prisma.investmentTransaction.count({ where: { userId: user.id } }),
    };
    await svc.sync.enqueueInvestmentSync(connectionId, "FULL_SYNC");
    await svc.sync.runInvestmentSyncWorker(25);
    expect(await prisma.investmentHolding.count({ where: { userId: user.id } })).toBe(before.holdings);
    expect(await prisma.investmentTransaction.count({ where: { userId: user.id } })).toBe(before.transactions);
  }, 120_000);

  it("CON-04: revoked consent stops future synchronization", async () => {
    const user = await createUser("revoke");
    const connectionId = await connectAndSync(user.id);
    await svc.connections.revokeConsent(user.id, connectionId);
    await svc.sync.enqueueInvestmentSync(connectionId, "INCREMENTAL_SYNC");
    const result = await svc.sync.runInvestmentSyncWorker(25);
    expect(result.processed).toBe(0);
    const connection = await prisma.investmentConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(connection.status).toBe("REVOKED");
  }, 120_000);

  it("PF-05: portfolio reports source-attributed, integer-minor-unit holdings", async () => {
    const user = await createUser("portfolio");
    await connectAndSync(user.id);
    const view = await svc.portfolio.getPortfolio(user.id);
    expect(view.holdings.length).toBeGreaterThan(0);
    expect(Number.isInteger(view.currentValueMinor)).toBe(true);
    expect(Number.isInteger(view.returnPctBps)).toBe(true);
    expect(view.allocation.length).toBeGreaterThan(0);
    expect(view.holdings.every((h: { source: string; isSandbox: boolean }) => h.source === "PROVIDER" && h.isSandbox)).toBe(true);
    expect(view.notice).toContain("not wallet balances");
  }, 120_000);

  it("PF-06: insights are explainable and never a fabricated health score", async () => {
    const user = await createUser("insights");
    await connectAndSync(user.id);
    const insights = await svc.portfolio.generateInsights(user.id);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.every((i: { explanation: string; dataAsOf: string }) => i.explanation.length > 10 && Boolean(i.dataAsOf))).toBe(true);
    expect(JSON.stringify(insights).toLowerCase()).not.toContain("health score");
  }, 120_000);

  it("WEALTH-07: net worth reuses account analytics and subtracts liabilities", async () => {
    const user = await createUser("wealth");
    await connectAndSync(user.id);
    const view = await svc.wealth.getNetWorth(user.id);
    expect(view.netWorthMinor).toBe(view.totalAssetsMinor - view.totalLiabilitiesMinor);
    expect(view.investmentsMinor).toBeGreaterThan(0);
    expect(Number.isInteger(view.netWorthMinor)).toBe(true);
    const snapshot = await svc.wealth.captureNetWorthSnapshot(user.id);
    expect(snapshot.netWorthMinor).toBe(view.netWorthMinor);
  }, 120_000);

  it("PLAN-08: SIP calculator and goals never create wallet transactions", async () => {
    const user = await createUser("plan");
    const before = await prisma.transactionRecord.count({ where: { userId: user.id } });
    const projection = svc.planning.calculateSipProjection({ monthlyMinor: 10_000_00, months: 12, assumedReturnBps: 0, frequency: "MONTHLY" });
    expect(projection.totalInvestedMinor).toBe(120_000_00);
    const goal = await svc.planning.createGoal(user.id, { name: "Emergency fund", goalType: "EMERGENCY", targetAmountMinor: 100_000_00 });
    expect(goal.progressBps).toBe(0);
    await svc.planning.addContribution(user.id, goal.id, { amountMinor: 25_000_00, kind: "MANUAL" });
    const updated = (await svc.planning.listGoals(user.id))[0]!;
    expect(updated.currentAmountMinor).toBe(25_000_00);
    expect(await prisma.transactionRecord.count({ where: { userId: user.id } })).toBe(before);
  }, 120_000);

  it("DISC-09: watchlists and price alerts use provider data", async () => {
    const user = await createUser("discover");
    const list = await svc.discovery.createWatchlist(user.id, { name: "Core", isDefault: true });
    const instruments = await svc.discovery.searchInstruments("SBN");
    expect(instruments.length).toBeGreaterThan(0);
    await svc.discovery.addWatchlistItem(user.id, list.id, instruments[0]!.id);
    const watchlists = await svc.discovery.listWatchlists(user.id);
    expect(watchlists[0]!.items.length).toBe(1);
    const alert = await svc.discovery.createPriceAlert(user.id, {
      instrumentId: instruments[0]!.id, direction: "ABOVE", thresholdMinor: 1,
    });
    expect(alert.status).toBe("ACTIVE");
  }, 120_000);

  it("SEC-10: users cannot access each other's investment data or documents", async () => {
    const [a, b] = await Promise.all([createUser("seca"), createUser("secb")]);
    await connectAndSync(a.id);
    const otherView = await svc.portfolio.getPortfolio(b.id);
    expect(otherView.holdings.length).toBe(0);
    const bytes = Buffer.from("%PDF-1.4 test statement");
    const doc = await svc.documents.uploadDocument(a.id,
      { bytes, fileName: "statement.pdf", contentType: "application/pdf" }, { kind: "STATEMENT" });
    const link = await svc.discovery.getDocumentLink(a.id, doc.id);
    const downloaded = await svc.documents.downloadDocument(a.id, doc.id, link.token, link.expiresAt);
    expect(downloaded.buffer.subarray(0, 4).toString()).toBe("%PDF");
    await expectApiError(svc.discovery.getDocumentLink(b.id, doc.id), 404);
  }, 120_000);

  it("OPS-11: Control reports real synchronization state", async () => {
    const view = await svc.control.getInvestmentOperations();
    expect(view.providers).toBeGreaterThan(0);
    expect(typeof view.staleHoldings).toBe("number");
    expect(view.holdings).toBeGreaterThan(0);
  }, 120_000);
});
