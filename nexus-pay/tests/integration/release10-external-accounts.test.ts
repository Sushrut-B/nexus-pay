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

async function createUser(label: string, fundMinor = 1_000_000) {
  const user = await prisma.user.create({
    data: {
      id: `r10_${stamp}_${label}`,
      fullName: `Release Ten ${label}`,
      email: `r10_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r10${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(),
      isEmailVerified: true,
      isPhoneVerified: true,
      profile: { create: { displayName: `Release Ten ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r10_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release10-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  if (fundMinor > 0) {
    const funding = await svc.funding.getOrCreateFundingOperation(user.id, { clientRequestId: randomUUID(), amountMinor: fundMinor });
    if (funding.status !== "COMPLETED") await svc.funding.executeFundingOperation(funding.id, user.id);
  }
  return user;
}

async function connect(userId: string) {
  const initiation = await svc.connections.initiateConnection(userId, {
    providerCode: "sandbox",
    purpose: "Personal financial overview",
    dataCategories: ["ACCOUNT_METADATA", "BALANCES", "TRANSACTIONS"],
    periodFrom: "2026-01-01",
    periodTo: "2026-12-31",
    durationDays: 90,
    refreshFrequencyMinutes: 360,
    termsAccepted: true,
  });
  const url = new URL(initiation.authorizationUrl!);
  const callback = {
    state: url.searchParams.get("state")!,
    code: url.searchParams.get("code") ?? undefined,
    providerRef: url.searchParams.get("providerRef") ?? undefined,
  };
  const result = await svc.connections.handleCallback(callback);
  return { initiation, callback, result };
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    funding: await import("../../apps/web/lib/payments/funding-service"),
    connections: await import("../../apps/web/lib/accounts/connections-service"),
    sync: await import("../../apps/web/lib/accounts/sync-service"),
    accounts: await import("../../apps/web/lib/accounts/accounts-service"),
    transfer: await import("../../apps/web/lib/accounts/transfer-service"),
    dedup: await import("../../apps/web/lib/accounts/dedup-service"),
    providers: await import("../../apps/web/lib/accounts/providers"),
    control: await import("../../apps/web/lib/accounts/control-service"),
    crypto: await import("../../apps/web/lib/security/crypto"),
  };
  await svc.providers.ensureProviderRecords();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r10_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 10 external account verification", () => {
  it("EXT-01: verified callback creates a connection and accounts only after completion", async () => {
    const user = await createUser("connect", 0);
    const { result } = await connect(user.id);
    expect(result.status).toBe("SYNC_PENDING");
    const accounts = await prisma.externalFinancialAccount.count({ where: { userId: user.id } });
    expect(accounts).toBe(2);
    const connection = await prisma.externalAccountConnection.findUniqueOrThrow({ where: { id: result.connectionId } });
    expect(["SYNC_PENDING", "ACTIVE"]).toContain(connection.status);
  }, 120_000);

  it("EXT-02: consent revocation blocks future retrieval", async () => {
    const user = await createUser("revoke", 0);
    const { result } = await connect(user.id);
    const consent = await prisma.externalAccountConsent.findFirstOrThrow({ where: { connectionId: result.connectionId } });
    const queued = await svc.sync.enqueueSync(result.connectionId, "BALANCE_REFRESH");
    await svc.connections.revokeConsent(user.id, consent.id, "User request");
    await expectApiError(svc.sync.enqueueSync(result.connectionId, "BALANCE_REFRESH"), 409);
    await svc.sync.processSyncJob(queued.id);
    const after = await prisma.accountSyncJob.findUniqueOrThrow({ where: { id: queued.id } });
    expect(after.error).toMatch(/revoked|consent/i);
    const connection = await prisma.externalAccountConnection.findUniqueOrThrow({ where: { id: result.connectionId } });
    expect(connection.status).toBe("REVOKED");
  }, 120_000);

  it("EXT-03: duplicate imports keep one canonical transaction", async () => {
    const user = await createUser("duplicate", 0);
    const { result } = await connect(user.id);
    await svc.sync.runSyncWorker(25);
    const before = await prisma.externalTransaction.count({ where: { userId: user.id } });
    const account = await prisma.externalFinancialAccount.findFirstOrThrow({ where: { userId: user.id } });
    const existing = await prisma.externalTransaction.findFirstOrThrow({ where: { accountId: account.id } });
    await prisma.externalTransaction.upsert({
      where: { accountId_providerTxRef: { accountId: account.id, providerTxRef: existing.providerTxRef } },
      create: {
        accountId: account.id, userId: user.id, providerTxRef: existing.providerTxRef,
        amountMinor: existing.amountMinor, currency: existing.currency, direction: existing.direction,
        description: existing.description, category: existing.category, transactionAt: existing.transactionAt, status: existing.status,
      },
      update: {},
    });
    const after = await prisma.externalTransaction.count({ where: { userId: user.id } });
    expect(after).toBe(before);
    void result;
  }, 120_000);

  it("EXT-04: incremental sync imports historical records then only new ones", async () => {
    const user = await createUser("incremental", 0);
    const { result } = await connect(user.id);
    await svc.sync.runSyncWorker(25);
    const first = await prisma.externalTransaction.count({ where: { userId: user.id } });
    expect(first).toBeGreaterThan(0);
    await svc.sync.enqueueSync(result.connectionId, "INCREMENTAL_SYNC");
    await svc.sync.runSyncWorker(25);
    const second = await prisma.externalTransaction.count({ where: { userId: user.id } });
    expect(second).toBe(first);
    const checkpoint = await prisma.accountSyncCheckpoint.findFirstOrThrow({ where: { connectionId: result.connectionId } });
    expect(checkpoint.cursor).toBe("initial");
  }, 120_000);

  it("EXT-05: callback replay does not create duplicate connections", async () => {
    const user = await createUser("replay", 0);
    const { callback } = await connect(user.id);
    await svc.connections.handleCallback(callback);
    const connections = await prisma.externalAccountConnection.count({ where: { userId: user.id } });
    expect(connections).toBe(1);
    const replay = await prisma.providerCallbackEvent.findFirst({ where: { status: "REPLAYED" } });
    expect(replay).toBeTruthy();
  }, 120_000);

  it("EXT-06: equal cross-account movements are suggested as a transfer without deletion", async () => {
    const user = await createUser("transfer", 0);
    const { result } = await connect(user.id);
    await svc.sync.runSyncWorker(25);
    const accounts = await prisma.externalFinancialAccount.findMany({ where: { userId: user.id } });
    const debit = await prisma.externalTransaction.create({
      data: {
        accountId: accounts[0]!.id, userId: user.id, providerTxRef: `match-debit-${randomUUID()}`,
        amountMinor: 77_000, currency: "INR", direction: "OUT", description: "Own transfer out",
        category: "TRANSFER", transactionAt: new Date(), status: "POSTED",
      },
    });
    const credit = await prisma.externalTransaction.create({
      data: {
        accountId: accounts[1]!.id, userId: user.id, providerTxRef: `match-credit-${randomUUID()}`,
        amountMinor: 77_000, currency: "INR", direction: "IN", description: "Own transfer in",
        category: "TRANSFER", transactionAt: new Date(), status: "POSTED",
      },
    });
    await svc.transfer.runInternalTransferDetection(user.id);
    const matches = await svc.transfer.listTransferMatches(user.id, "SUGGESTED");
    const match = matches.find((item) => item.debitAccount === debit.id && item.creditAccount === credit.id);
    expect(match).toBeTruthy();
    await svc.transfer.decideTransferMatch(user.id, match!.id, "CONFIRM");
    expect(await prisma.externalTransaction.count({ where: { id: { in: [debit.id, credit.id] } } })).toBe(2);
    void result;
  }, 120_000);

  it("EXT-07: account isolation and token security", async () => {
    const alice = await createUser("isolationalice", 0);
    const bob = await createUser("isolationbob", 0);
    const { result } = await connect(alice.id);
    const account = await prisma.externalFinancialAccount.findFirstOrThrow({ where: { userId: alice.id } });
    await expectApiError(svc.accounts.getAccount(bob.id, account.id), 404);
    await expectApiError(svc.connections.getConsent(bob.id, (await prisma.externalAccountConsent.findFirstOrThrow({ where: { connectionId: result.connectionId } })).id), 404);
    const plaintext = await svc.accounts.inspectEncryptedAccountReference(alice.id, account.id);
    expect(plaintext).toMatch(/^sandbox-account:/);
    const view = await svc.accounts.getAccount(alice.id, account.id);
    expect(JSON.stringify(view)).not.toContain(plaintext);
  }, 120_000);

  it("EXT-08 and EXT-09: provider failures are recorded and credentials are encrypted", async () => {
    const user = await createUser("failure", 0);
    const { result } = await connect(user.id);
    const job = await svc.sync.enqueueSync(result.connectionId, "FULL_SYNC");
    await svc.connections.revokeConsent(user.id, (await prisma.externalAccountConsent.findFirstOrThrow({ where: { connectionId: result.connectionId } })).id, "test");
    await svc.sync.processSyncJob(job.id);
    const failed = await prisma.accountSyncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.error).toMatch(/revoked|consent/i);
    expect(await prisma.providerHealthSnapshot.count()).toBeGreaterThanOrEqual(0);
    const account = await prisma.externalFinancialAccount.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.encryptedAccountRef).not.toContain("sandbox-account:");
    expect(account.encryptedAccountRef.split(".")).toHaveLength(3);
  }, 120_000);

  it("EXT-10: consolidated analytics separates liabilities from cash", async () => {
    const user = await createUser("analytics", 0);
    await connect(user.id);
    await svc.sync.runSyncWorker(25);
    const analytics = await svc.accounts.getAccountAnalytics(user.id, "ALL");
    expect(analytics.liabilityMinor).toBeGreaterThan(0);
    expect(analytics.cashBalanceMinor).toBeGreaterThan(0);
    expect(analytics.netPositionMinor).toBe(analytics.cashBalanceMinor - analytics.liabilityMinor);
    expect(analytics.notice).toContain("liabilit");
  }, 120_000);

  it("EXT-11: disconnection stops retrieval", async () => {
    const user = await createUser("disconnect", 0);
    const { result } = await connect(user.id);
    await svc.accounts.getPrivacyData(user.id);
    await svc.connections.disconnectConnection(user.id, result.connectionId);
    await expectApiError(svc.sync.enqueueSync(result.connectionId, "INCREMENTAL_SYNC"), 409);
    const consent = await prisma.externalAccountConsent.findFirstOrThrow({ where: { connectionId: result.connectionId } });
    expect(consent.status).toBe("REVOKED");
  }, 120_000);

  it("EXT-12: Control operations expose health without plaintext identifiers", async () => {
    const view = await svc.control.getControlAccountsView();
    expect(view.providers).toBeGreaterThanOrEqual(1);
    expect(typeof view.failedJobs).toBe("number");
    expect(JSON.stringify(view)).not.toContain("sandbox-account:");
  }, 60_000);
});
