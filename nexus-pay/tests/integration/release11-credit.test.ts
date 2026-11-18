import { createHmac } from "node:crypto";
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
      id: `r11_${stamp}_${label}`,
      fullName: `Release Eleven ${label}`,
      email: `r11_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r11${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Eleven ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r11_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release11-test" } });
  await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return user;
}

function sign(payload: object, timestamp: string): string {
  return createHmac("sha256", svc.env.getServerEnv().AUTH_SECRET)
    .update(`${timestamp}.${JSON.stringify(payload)}`)
    .digest("hex");
}

async function createApplication(userId: string) {
  const offers = await svc.catalog.listOffers();
  const offer = offers[0]!;
  return svc.application.createApplication(userId, {
    offerId: offer.id,
    employmentCategory: "SALARIED",
    monthlyIncomeRange: "25000_50000",
    employmentMonths: 24,
    existingObligationsMinor: 0,
    requestedAmountMinor: offer.amountMinor,
    requestedTenureMonths: offer.tenureMonths,
    purpose: "Test personal loan",
    idempotencyKey: `app-${randomUUID()}`,
    disclosuresAccepted: true,
    consentVersion: "sandbox-v1",
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    env: await import("../../apps/web/lib/env"),
    catalog: await import("../../apps/web/lib/credit/catalog-service"),
    eligibility: await import("../../apps/web/lib/credit/eligibility-service"),
    application: await import("../../apps/web/lib/credit/application-service"),
    loan: await import("../../apps/web/lib/credit/loan-service"),
    document: await import("../../apps/web/lib/credit/document-service"),
    webhook: await import("../../apps/web/lib/credit/webhook-service"),
    affordability: await import("../../apps/web/lib/credit/affordability-service"),
    control: await import("../../apps/web/lib/credit/control-service"),
    calculations: await import("../../apps/web/lib/credit/calculations"),
    providers: await import("../../apps/web/lib/credit/providers"),
  };
  await svc.providers.ensureLenderRecords();
  await prisma.providerSyncJob.deleteMany({});
  await prisma.lenderWebhookEvent.deleteMany({});
  await svc.catalog.syncCatalog();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r11_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 11 credit verification", () => {
  it("CRED-01: provider-backed offers compare using documented EMI rules", async () => {
    const offers = await svc.catalog.listOffers();
    expect(offers.length).toBeGreaterThanOrEqual(1);
    const result = await svc.catalog.compareOffers([offers[0]!.id, offers[1]!.id]);
    expect(result.offers).toHaveLength(2);
    for (const offer of result.offers) {
      if (offer.emiMinor && offer.emiMinor > 0) {
        expect(offer.totalRepaymentMinor).toBeGreaterThanOrEqual(offer.amountMinor);
      }
    }
  }, 120_000);

  it("CRED-02: eligibility is a pre-assessment, never an approval", async () => {
    const user = await createUser("eligibility");
    const product = (await svc.catalog.listProducts())[0]!;
    const result = await svc.eligibility.assessEligibility(user.id, {
      productId: product.id,
      employmentCategory: "SALARIED",
      monthlyIncomeRange: "25000_50000",
      employmentMonths: 24,
      existingObligationsMinor: 0,
      requestedAmountMinor: 1_000_000,
      requestedTenureMonths: 24,
      purpose: "Test",
    });
    expect(result.outcome).toBe("PRE_ASSESSMENT_ONLY");
    expect(result.explanation).toMatch(/not a credit approval/i);
    expect(result.observedFields).toContain("recordedMonthlyInflowMinor");
  }, 120_000);

  it("CRED-03: repeated application submission does not duplicate provider submissions", async () => {
    const user = await createUser("submit");
    const application = await createApplication(user.id);
    const first = await svc.application.submitApplication(user.id, application.id);
    const second = await svc.application.submitApplication(user.id, application.id);
    expect(second.providerApplicationRef).toBe(first.providerApplicationRef);
    const history = await prisma.loanApplicationStatusHistory.count({
      where: { applicationId: application.id, toStatus: "SUBMITTED" },
    });
    expect(history).toBe(1);
  }, 120_000);

  it("CRED-04: a provider capability failure does not falsely mark submission", async () => {
    const user = await createUser("capability");
    const application = await createApplication(user.id);
    const provider = await prisma.lendingProvider.findFirstOrThrow({ where: { code: "sandbox-lender" } });
    await prisma.lendingProviderCapability.update({
      where: { providerId_capability: { providerId: provider.id, capability: "applicationSubmission" } },
      data: { enabled: false },
    });
    await expectApiError(svc.application.submitApplication(user.id, application.id), 409);
    const after = await prisma.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(after.status).toBe("DRAFT");
    await prisma.lendingProviderCapability.update({
      where: { providerId_capability: { providerId: provider.id, capability: "applicationSubmission" } },
      data: { enabled: true },
    });
  }, 120_000);

  it("CRED-05: only verified provider events change application status", async () => {
    const user = await createUser("events");
    const application = await createApplication(user.id);
    const submitted = await svc.application.submitApplication(user.id, application.id);
    const payload = {
      applicationRef: submitted.providerApplicationRef,
      status: "UNDER_REVIEW",
    };
    const timestamp = String(Date.now());
    const invalid = await svc.webhook.receiveWebhook("sandbox-lender", {
      eventType: "APPLICATION_STATUS_CHANGED", eventId: `ev-${randomUUID()}`,
      signature: "invalid", timestamp, payload,
    });
    expect(invalid.status).toBe("RECEIVED");
    const invalidRow = await prisma.lenderWebhookEvent.findUniqueOrThrow({ where: { id: invalid.eventId } });
    expect(invalidRow.signatureValid).toBe(false);
    const afterUnverified = await prisma.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(afterUnverified.status).toBe("SUBMITTED");
    const eventId = `ev-${randomUUID()}`;
    const received = await svc.webhook.receiveWebhook("sandbox-lender", {
      eventType: "APPLICATION_STATUS_CHANGED", eventId, signature: sign(payload, timestamp), timestamp, payload,
    });
    const eventRow = await prisma.lenderWebhookEvent.findUniqueOrThrow({ where: { id: received.eventId } });
    expect(eventRow.signatureValid).toBe(true);
    await svc.webhook.runProviderSyncWorker(10);
    const afterVerified = await prisma.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(afterVerified.status).toBe("UNDER_REVIEW");
  }, 120_000);

  it("CRED-06: a loan becomes active only after verified disbursement, replay is safe", async () => {
    const user = await createUser("disbursement");
    const application = await createApplication(user.id);
    await svc.application.submitApplication(user.id, application.id);
    const provider = await prisma.lendingProvider.findUniqueOrThrow({ where: { code: "sandbox-lender" } });
    const offer = await prisma.creditOffer.findUniqueOrThrow({ where: { id: application.offerId } });
    const applicationRow = await prisma.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
    const payload = {
      applicationRef: applicationRow.providerApplicationRef,
      loanRef: `loan-${randomUUID()}`,
      principalMinor: offer.amountMinor,
      interestRateBps: offer.interestRateBps,
      tenureMonths: offer.tenureMonths,
      emiMinor: offer.emiMinor ?? 0,
    };
    const timestamp = String(Date.now());
    const eventId = `ev-${randomUUID()}`;
    await svc.webhook.receiveWebhook("sandbox-lender", {
      eventType: "LOAN_DISBURSED", eventId, signature: sign(payload, timestamp), timestamp, payload,
    });
    await svc.webhook.runProviderSyncWorker(10);
    const loans = await prisma.activeLoan.count({ where: { userId: user.id } });
    expect(loans).toBe(1);
    const after = await prisma.loanApplication.findUniqueOrThrow({ where: { id: application.id } });
    expect(after.status).toBe("DISBURSED");
    await svc.webhook.receiveWebhook("sandbox-lender", {
      eventType: "LOAN_DISBURSED", eventId, signature: sign(payload, timestamp), timestamp, payload,
    });
    expect(await prisma.activeLoan.count({ where: { userId: user.id } })).toBe(1);
    void provider;
  }, 120_000);

  it("CRED-07 and CRED-08: provider schedule and confirmations are idempotent", async () => {
    const user = await createUser("repayments");
    const application = await createApplication(user.id);
    await svc.application.submitApplication(user.id, application.id);
    const adapter = svc.providers.getLenderAdapter("sandbox-lender");
    const loan = await svc.loan.activateLoanFromProvider({
      userId: user.id, applicationId: application.id,
      providerId: (await prisma.lendingProvider.findUniqueOrThrow({ where: { code: "sandbox-lender" } })).id,
      providerLoanRef: `loan-${randomUUID()}`, principalMinor: 1_000_000, interestRateBps: 1200,
      tenureMonths: 12, emiMinor: 90_000, evidence: `disburse-${randomUUID()}`,
    });
    const rows = await adapter.fetchRepaymentSchedule(loan);
    expect(await svc.loan.importProviderSchedule(loan, rows)).toBe(12);
    const first = await svc.loan.confirmProviderRepayment({
      loanId: loan, providerRef: `repay-${randomUUID()}`, amountMinor: 90_000,
      paidAt: new Date(), evidence: `evidence-${randomUUID()}`,
    });
    const second = await svc.loan.confirmProviderRepayment({
      loanId: loan,
      providerRef: (await prisma.loanRepayment.findFirstOrThrow({ where: { loanId: loan } })).providerRef,
      amountMinor: 90_000, paidAt: new Date(), evidence: "replay",
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
  }, 120_000);

  it("CRED-09: loan documents are isolated per customer", async () => {
    const alice = await createUser("documentsalice");
    const bob = await createUser("documentsbob");
    const application = await createApplication(alice.id);
    const document = await svc.document.uploadDocument(alice.id, application.id, { category: "IDENTITY" }, {
      bytes: Buffer.from("%PDF-1.4 test"),
      fileName: "identity.pdf",
      contentType: "application/pdf",
    });
    await expectApiError(svc.document.getDownloadLink(bob.id, document.id), 404);
    const link = await svc.document.getDownloadLink(alice.id, document.id);
    const downloaded = await svc.document.downloadDocument(alice.id, document.id, link.token, link.expiresAt);
    expect(downloaded.buffer.toString()).toContain("%PDF-1.4");
  }, 120_000);

  it("CRED-10: affordability uses actual records and exposes coverage", async () => {
    const user = await createUser("affordability");
    const scenario = await svc.affordability.createScenario(user.id, {
      amountMinor: 1_000_000, tenureMonths: 24, interestRateBps: 1200,
    });
    expect(scenario.emiMinor).toBeGreaterThan(0);
    expect(scenario.dataCoverageBps).toBeGreaterThanOrEqual(0);
    expect(scenario.notice).toMatch(/not a lending decision/i);
  }, 120_000);

  it("CRED-11: Control view exposes no applicant identity", async () => {
    const view = await svc.control.getCreditOperations();
    expect(view.providers).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(view)).not.toContain("employmentCategory");
  }, 60_000);
});
