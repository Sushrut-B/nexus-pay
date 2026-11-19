import { createHmac, randomUUID } from "node:crypto";
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
      id: `r12_${stamp}_${label}`,
      fullName: `Release Twelve ${label}`,
      email: `r12_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r12${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Twelve ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r12_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release12-test" } });
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

async function createQuote(userId: string, productId: string) {
  return svc.quote.createQuote(userId, {
    productId,
    answers: { age: 30, coverage: 500_000 },
    consentVersion: "sandbox-v1",
    termsAccepted: true,
  });
}

async function createApplication(userId: string, productId: string, quoteId?: string) {
  return svc.application.createApplication(userId, {
    productId,
    quoteId,
    applicantData: { fullName: "Test Applicant", age: 30 },
    idempotencyKey: `app-${randomUUID()}`,
    consentVersion: "sandbox-v1",
    disclosuresAccepted: true,
  });
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    env: await import("../../apps/web/lib/env"),
    catalog: await import("../../apps/web/lib/insurance/catalog-service"),
    quote: await import("../../apps/web/lib/insurance/quote-service"),
    application: await import("../../apps/web/lib/insurance/application-service"),
    policy: await import("../../apps/web/lib/insurance/policy-service"),
    claim: await import("../../apps/web/lib/insurance/claim-service"),
    consent: await import("../../apps/web/lib/insurance/consent-service"),
    document: await import("../../apps/web/lib/insurance/document-service"),
    webhook: await import("../../apps/web/lib/insurance/webhook-service"),
    control: await import("../../apps/web/lib/insurance/control-service"),
    providers: await import("../../apps/web/lib/insurance/providers"),
    calculations: await import("../../apps/web/lib/insurance/calculations"),
  };
  await svc.providers.ensureInsurerRecords();
  await prisma.insuranceProviderSync.deleteMany({});
  await prisma.insuranceProviderWebhook.deleteMany({});
  await svc.catalog.syncCatalog();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r12_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 12 insurance verification", () => {
  it("INS-01: provider-backed catalogue is synchronized and clearly labelled", async () => {
    const providers = await prisma.insuranceProvider.findMany({ where: { status: "AVAILABLE" } });
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.every((provider) => provider.mode === "SANDBOX")).toBe(true);
    const products = await svc.catalog.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(2);
    expect(products.every((product) => product.isSandbox)).toBe(true);
    expect(products.every((product) => product.coverageMinor === null || Number.isInteger(product.coverageMinor))).toBe(true);
  }, 120_000);

  it("INS-02: comparison rejects unrelated categories and lists missing fields", async () => {
    const health = (await svc.catalog.listProducts("HEALTH"))[0]!;
    const term = (await svc.catalog.listProducts("TERM_LIFE"))[0]!;
    await expectApiError(svc.catalog.compareProducts([health.id, term.id]), 400);
    const same = await svc.catalog.compareProducts([health.id, health.id]);
    expect(same.products).toHaveLength(2);
    expect(same.category).toBe("HEALTH");
    expect(same.notice).toContain("No ranking score");
  }, 120_000);

  it("INS-03: quote is provider-generated with recorded consent, never presented as coverage", async () => {
    const user = await createUser("quote");
    const product = (await svc.catalog.listProducts())[0]!;
    const quote = await createQuote(user.id, product.id);
    expect(quote.status).toBe("QUOTE_AVAILABLE");
    expect(quote.isEstimate).toBe(false);
    expect(quote.premiumMinor).toBeGreaterThan(0);
    const consent = await prisma.insuranceConsent.findFirst({ where: { userId: user.id } });
    expect(consent?.purpose).toContain("quotation");
    const snapshot = await prisma.insuranceQuoteSnapshot.findFirst({ where: { quoteId: quote.id } });
    expect(snapshot).not.toBeNull();
  }, 120_000);

  it("APP-04: application submission is idempotent and requires active consent", async () => {
    const user = await createUser("application");
    const product = (await svc.catalog.listProducts())[0]!;
    const application = await createApplication(user.id, product.id);
    expect(application.status).toBe("DRAFT");
    const submitted = await svc.application.submitApplication(user.id, application.id);
    expect(submitted.status).toBe("SUBMITTED");
    const replayed = await svc.application.submitApplication(user.id, application.id);
    expect(replayed.id).toBe(submitted.id);
    const idempotencyKey = `app-${randomUUID()}`;
    const first = await svc.application.createApplication(user.id, {
      productId: product.id, applicantData: { fullName: "Test Applicant" },
      idempotencyKey, consentVersion: "sandbox-v1", disclosuresAccepted: true,
    });
    const second = await svc.application.createApplication(user.id, {
      productId: product.id, applicantData: { fullName: "Test Applicant" },
      idempotencyKey, consentVersion: "sandbox-v1", disclosuresAccepted: true,
    });
    expect(second.id).toBe(first.id);
  }, 120_000);

  it("APP-05: a capability-disabled provider rejects submission without faking success", async () => {
    const user = await createUser("capability");
    const product = (await svc.catalog.listProducts())[0]!;
    const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: product.providerId } });
    await prisma.insuranceProviderCapability.update({
      where: { providerId_capability: { providerId: provider.id, capability: "applications" } },
      data: { enabled: false },
    });
    const application = await createApplication(user.id, product.id);
    await expectApiError(svc.application.submitApplication(user.id, application.id), 409);
    await prisma.insuranceProviderCapability.update({
      where: { providerId_capability: { providerId: provider.id, capability: "applications" } },
      data: { enabled: true },
    });
  }, 120_000);

  it("WEB-06: unsigned events are rejected and valid events are deduplicated", async () => {
    const provider = await prisma.insuranceProvider.findFirstOrThrow({ where: { status: "AVAILABLE" } });
    const bad = await svc.webhook.receiveWebhook(provider.code, {
      eventType: "APPLICATION_SUBMITTED", eventId: `bad-${stamp}`, signature: "invalidsignature",
      timestamp: "1700000000", payload: { providerRef: "ins_missing" },
    });
    expect(bad.status).toBe("FAILED");
    const payload = { providerRef: "ins_nonexistent" };
    const timestamp = "1700000001";
    const signature = sign(payload, timestamp);
    const first = await svc.webhook.receiveWebhook(provider.code, {
      eventType: "APPLICATION_SUBMITTED", eventId: `good-${stamp}`, signature, timestamp, payload,
    });
    const second = await svc.webhook.receiveWebhook(provider.code, {
      eventType: "APPLICATION_SUBMITTED", eventId: `good-${stamp}`, signature, timestamp, payload,
    });
    expect(first.eventId).toBe(second.eventId);
    const events = await prisma.insuranceProviderWebhook.count({ where: { eventId: `good-${stamp}` } });
    expect(events).toBe(1);
  }, 120_000);

  it("POL-07: a policy appears only after a verified provider issuance event", async () => {
    const user = await createUser("policy");
    const product = (await svc.catalog.listProducts("HEALTH"))[0]!;
    const application = await createApplication(user.id, product.id);
    await svc.application.submitApplication(user.id, application.id);
    const appRow = await prisma.insuranceApplication.findUniqueOrThrow({ where: { id: application.id } });
    const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: appRow.providerId } });
    expect(await svc.policy.listPolicies(user.id)).toHaveLength(0);

    const payload = { providerRef: appRow.providerRef };
    const timestamp = "1700000002";
    const signature = sign(payload, timestamp);
    await svc.webhook.receiveWebhook(provider.code, {
      eventType: "POLICY_ISSUED", eventId: `issued-${stamp}`, signature, timestamp, payload,
    });
    await svc.webhook.runProviderSyncWorker(25);
    const policies = await svc.policy.listPolicies(user.id);
    expect(policies.length).toBe(1);
    expect(policies[0]!.status).toBe("ACTIVE");
    expect(policies[0]!.policyNumberMasked).toContain("XXXX");
  }, 120_000);

  it("CLM-08: claim status follows provider-confirmed transitions with history", async () => {
    const user = await createUser("claim");
    const product = (await svc.catalog.listProducts("HEALTH"))[0]!;
    const application = await createApplication(user.id, product.id);
    await svc.application.submitApplication(user.id, application.id);
    const appRow = await prisma.insuranceApplication.findUniqueOrThrow({ where: { id: application.id } });
    const provider = await prisma.insuranceProvider.findUniqueOrThrow({ where: { id: appRow.providerId } });
    const payload = { providerRef: appRow.providerRef };
    const timestamp = "1700000003";
    await svc.webhook.receiveWebhook(provider.code, {
      eventType: "POLICY_ISSUED", eventId: `claim-policy-${stamp}`, signature: sign(payload, timestamp), timestamp, payload,
    });
    await svc.webhook.runProviderSyncWorker(25);
    const policy = (await svc.policy.listPolicies(user.id))[0]!;
    const claim = await svc.claim.createClaim(user.id, {
      policyId: policy.id, claimType: "HEALTH", incidentDate: "2026-01-15T00:00:00.000Z",
    });
    expect(claim.status).toBe("DRAFT");
    const submitted = await svc.claim.submitClaim(user.id, claim.id);
    expect(submitted.status).toBe("SUBMITTED");
    const history = await svc.claim.getClaimHistory(user.id, claim.id);
    expect(history.some((row: { toStatus: string }) => row.toStatus === "SUBMITTED")).toBe(true);
  }, 120_000);

  it("DOC-09: document access is isolated per user and uses signed short-lived links", async () => {
    const [owner, other] = await Promise.all([createUser("docowner"), createUser("docother")]);
    const product = (await svc.catalog.listProducts())[0]!;
    const application = await createApplication(owner.id, product.id);
    const bytes = Buffer.from("%PDF-1.4 test insurance document");
    const uploaded = await svc.document.uploadDocument(owner.id, "APPLICATION", application.id,
      { category: "ID_PROOF" }, { bytes, fileName: "proof.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe("READY");
    await expectApiError(svc.document.listDocuments(other.id, "APPLICATION", application.id), 404);
    await expectApiError(svc.document.getDownloadLink(other.id, uploaded.id), 404);
    const link = await svc.document.getDownloadLink(owner.id, uploaded.id);
    expect(link.expiresAt).toBeGreaterThan(Date.now());
    expect(link.token).toHaveLength(64);
    const downloaded = await svc.document.downloadDocument(owner.id, uploaded.id, link.token, link.expiresAt);
    expect(downloaded.buffer.subarray(0, 4).toString()).toBe("%PDF");
    await expectApiError(svc.document.downloadDocument(owner.id, uploaded.id, "bad", link.expiresAt), 403);
  }, 120_000);

  it("CON-10: revoked consent blocks future provider data sharing", async () => {
    const user = await createUser("consent");
    const product = (await svc.catalog.listProducts())[0]!;
    const application = await createApplication(user.id, product.id);
    const consent = await prisma.insuranceConsent.findFirstOrThrow({ where: { userId: user.id } });
    await svc.consent.revokeConsent(user.id, consent.id);
    await expectApiError(svc.application.submitApplication(user.id, application.id), 403);
  }, 120_000);

  it("OPS-11: Control view exposes aggregate health without customer PII", async () => {
    const view = await svc.control.getInsuranceOperations();
    const serialized = JSON.stringify(view);
    expect(serialized).toContain("providers");
    expect(serialized).not.toMatch(/@example\.test|Test Applicant|policyNumber/i);
  }, 120_000);

  it("OPS-12: premium schedule and renewal math use integer minor units", () => {
    const rows = svc.calculations.buildPremiumSchedule({
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2027-01-01T00:00:00.000Z"),
      amountMinor: 8_000_00,
      frequency: "YEARLY",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.amountMinor).toBe(800_000);
  }, 120_000);
});
