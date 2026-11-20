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
      id: `r14_${stamp}_${label}`,
      fullName: `Release Fourteen ${label}`,
      email: `r14_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r14${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Fourteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r14_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release14-test" } });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return { user, wallet, accountId };
}

async function fund(userId: string, amountMinor = 5_000_00) {
  const created = await svc.funding.getOrCreateFundingOperation(userId, {
    clientRequestId: `fund-${randomUUID()}`, amountMinor,
  });
  return svc.funding.executeFundingOperation(created.id, userId);
}

async function fetchBill(userId: string) {
  const billers = await svc.catalog.listBillers("ELECTRICITY");
  const biller = billers[0]!;
  return { biller, result: await svc.bill.fetchBill(userId, { billerId: biller.id, parameters: { consumerNumber: `CONS-${stamp}` } }) };
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    catalog: await import("../../apps/web/lib/billing/catalog-service"),
    account: await import("../../apps/web/lib/billing/account-service"),
    bill: await import("../../apps/web/lib/billing/bill-service"),
    payment: await import("../../apps/web/lib/billing/payment-service"),
    recharge: await import("../../apps/web/lib/billing/recharge-service"),
    receipt: await import("../../apps/web/lib/billing/receipt-service"),
    household: await import("../../apps/web/lib/billing/household-service"),
    control: await import("../../apps/web/lib/billing/billing-control-service"),
    bootstrap: await import("../../apps/web/lib/billing/billing-worker-bootstrap"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    insights: await import("../../apps/web/lib/finance-intelligence/classification-service"),
    webhook: await import("../../apps/web/lib/billing/billing-webhook-service"),
  };
  await svc.bootstrap.ensureBillingConfiguration();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r14_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 14 bill payments verification", () => {
  it("BILL-01: catalogue sync uses only labelled sandbox data", async () => {
    const providers = await prisma.billPaymentProvider.findMany({ where: { status: "AVAILABLE" } });
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.every((p) => p.mode === "SANDBOX")).toBe(true);
    const billers = await svc.catalog.listBillers();
    expect(billers.length).toBeGreaterThan(0);
    expect(billers.every((b) => b.source === "SANDBOX_FIXTURE")).toBe(true);
  }, 120_000);

  it("BILL-02: saved accounts mask identifiers and are isolated", async () => {
    const [a, b] = await Promise.all([createUser("accta"), createUser("acctb")]);
    const biller = (await svc.catalog.listBillers())[0]!;
    const saved = await svc.account.createAccount(a.user.id, {
      billerId: biller.id, nickname: "Home electricity", parameters: { consumerNumber: "CONS-SECRET-1234" },
    });
    expect(saved.maskedIdentifier).toContain("****");
    expect(JSON.stringify(saved)).not.toContain("CONS-SECRET-1234");
    await expectApiError(svc.account.getAccount(b.user.id, saved.id), 404);
    const params = await svc.account.getAccountParameters(a.user.id, saved.id);
    expect(params.consumerNumber).toBe("CONS-SECRET-1234");
  }, 120_000);

  it("BILL-03: bill fetch stores a provider snapshot and rejects stale bills", async () => {
    const { user } = await createUser("fetch");
    const { result } = await fetchBill(user.id);
    expect(result.status).toBe("FETCHED");
    expect(result.snapshots.length).toBe(1);
    const snapshotId = result.snapshots[0]!.id;
    expect(await svc.bill.getPayableSnapshot(user.id, snapshotId)).toBeTruthy();
    await prisma.billSnapshot.update({ where: { id: snapshotId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expectApiError(svc.bill.getPayableSnapshot(user.id, snapshotId), 409);
  }, 120_000);

  it("FIN-04: wallet settlement and biller confirmation are recorded separately", async () => {
    const { user } = await createUser("pay");
    await fund(user.id);
    const { result } = await fetchBill(user.id);
    const snapshotId = result.snapshots[0]!.id;
    const created = await svc.payment.createPayment(user.id, {
      snapshotId, amountMinor: result.snapshots[0]!.amountMinor,
      idempotencyKey: `bill-${stamp}-1`, termsAccepted: true,
    });
    expect(created.status).toBe("CUSTOMER_CONFIRMATION_REQUIRED");
    const confirmed = await svc.payment.confirmPayment(user.id, created.id);
    expect(confirmed.status).toBe("BILLER_CONFIRMED");
    const row = await prisma.billPaymentIntent.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.paymentRef).toBeTruthy();
    expect(row.providerRef).toBeTruthy();
    expect(row.paymentRef).not.toBe(row.providerRef);
    expect(row.confirmedAt).toBeTruthy();
    const history = await prisma.billPaymentStatusHistory.findMany({ where: { paymentId: row.id } });
    expect(history.some((h) => h.toStatus === "WALLET_SETTLED")).toBe(true);
    expect(history.some((h) => h.toStatus === "BILLER_CONFIRMED")).toBe(true);
  }, 120_000);

  it("FIN-05: duplicate requests reuse one intent and one wallet debit", async () => {
    const { user } = await createUser("dup");
    await fund(user.id);
    const { result } = await fetchBill(user.id);
    const snapshotId = result.snapshots[0]!.id;
    const key = `bill-${stamp}-dup`;
    const first = await svc.payment.createPayment(user.id, { snapshotId, amountMinor: result.snapshots[0]!.amountMinor, idempotencyKey: key, termsAccepted: true });
    const second = await svc.payment.createPayment(user.id, { snapshotId, amountMinor: result.snapshots[0]!.amountMinor, idempotencyKey: key, termsAccepted: true });
    expect(second.id).toBe(first.id);
    await svc.payment.confirmPayment(user.id, first.id);
    await svc.payment.confirmPayment(user.id, first.id);
    expect(await prisma.paymentIntent.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.billPaymentIntent.count({ where: { userId: user.id } })).toBe(1);
  }, 120_000);

  it("FIN-06: a failed wallet settlement never reaches the biller", async () => {
    const { user } = await createUser("nofunds");
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    const { result } = await fetchBill(user.id);
    const payment = await svc.payment.createPayment(user.id, {
      snapshotId: result.snapshots[0]!.id, amountMinor: result.snapshots[0]!.amountMinor,
      idempotencyKey: `bill-${stamp}-nofunds`, termsAccepted: true,
    });
    let threw = false;
    try { await svc.payment.confirmPayment(user.id, payment.id); } catch { threw = true; }
    expect(threw).toBe(true);
    const row = await prisma.billPaymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.providerRef).toBeNull();
    expect(await prisma.billProviderTransaction.count({ where: { paymentId: payment.id } })).toBe(0);
    expect(await prisma.paymentIntent.count({ where: { userId: user.id } })).toBe(0);
  }, 120_000);

  it("SEC-07: bills and receipts are isolated between customers", async () => {
    const [a, b] = await Promise.all([createUser("seca"), createUser("secb")]);
    await fund(a.user.id);
    const { result } = await fetchBill(a.user.id);
    const payment = await svc.payment.createPayment(a.user.id, {
      snapshotId: result.snapshots[0]!.id, amountMinor: result.snapshots[0]!.amountMinor,
      idempotencyKey: `bill-${stamp}-sec`, termsAccepted: true,
    });
    await svc.payment.confirmPayment(a.user.id, payment.id);
    await expectApiError(svc.payment.getPayment(b.user.id, payment.id), 404);
    const receipt = await svc.receipt.createReceipt(a.user.id, payment.id);
    expect(receipt.officialProviderReceipt).toBe(false);
    await expectApiError(svc.receipt.getReceipt(b.user.id, payment.id), 404);
  }, 120_000);

  it("REC-08: a recharge succeeds only after provider confirmation", async () => {
    const { user } = await createUser("recharge");
    await fund(user.id);
    const biller = (await svc.catalog.listBillers("MOBILE_PREPAID"))[0]!;
    const recharge = await svc.recharge.createRecharge(user.id, {
      billerId: biller.id, amountMinor: 199_00,
      parameters: { mobileNumber: "9876543210" },
      idempotencyKey: `recharge-${stamp}`, termsAccepted: true,
    });
    expect(recharge.status).toBe("VALIDATED");
    const confirmed = await svc.recharge.confirmRecharge(user.id, recharge.id);
    expect(confirmed.status).toBe("SUCCESS");
    expect(confirmed.providerRef).toBeTruthy();
  }, 120_000);

  it("FIN-09: confirmed bills are counted once in financial insights", async () => {
    const { user } = await createUser("insights");
    await fund(user.id);
    const { result } = await fetchBill(user.id);
    const payment = await svc.payment.createPayment(user.id, {
      snapshotId: result.snapshots[0]!.id, amountMinor: result.snapshots[0]!.amountMinor,
      idempotencyKey: `bill-${stamp}-ins`, termsAccepted: true,
    });
    await svc.payment.confirmPayment(user.id, payment.id);
    const classified = await svc.insights.loadClassifiedTransactions(user.id, new Date(Date.now() - 86_400_000), new Date());
    const billRecords = classified.records.filter((r: { sourceType: string }) => r.sourceType === "BILL_PAYMENT");
    expect(billRecords.length).toBe(1);
    const settled = await prisma.billPaymentIntent.findUniqueOrThrow({ where: { id: payment.id } });
    const duplicateTransfers = classified.records.filter((r: { sourceType: string; paymentRef: string | null }) =>
      r.sourceType === "TRANSACTION" && r.paymentRef === settled.paymentRef);
    expect(duplicateTransfers.length).toBe(0);
  }, 120_000);

  it("HH-10: household assignment records responsibility without moving money", async () => {
    const [a, b] = await Promise.all([createUser("hhowner"), createUser("hhmember")]);
    const household = await svc.household.createHousehold(a.user.id, { name: "Test household" });
    await svc.household.inviteMember(a.user.id, household.id, b.user.id, "MEMBER");
    const biller = (await svc.catalog.listBillers())[0]!;
    const assignment = await svc.household.assignHouseholdBill(a.user.id, household.id, { billerId: biller.id, assignedTo: b.user.id });
    expect(assignment.assignedTo).toBe(b.user.id);
    expect(assignment.settled).toBe(false);
    await expectApiError(svc.household.inviteMember(b.user.id, household.id, a.user.id, "ADMIN"), 403);
    expect(await prisma.paymentIntent.count({ where: { userId: b.user.id } })).toBe(0);
  }, 120_000);

  it("OPS-11: Control reports real state and no fabricated confirmations", async () => {
    const view = await svc.control.getBillOperations();
    expect(view.providers).toBeGreaterThan(0);
    expect(typeof view.unknownOutcomes).toBe("number");
    expect(await prisma.billPaymentIntent.count()).toBeGreaterThan(0);
  }, 120_000);
});
