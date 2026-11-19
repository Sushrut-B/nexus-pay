import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SandboxInsurerAdapter, SANDBOX_INSURER_NOTICE } from "../../apps/web/lib/insurance/providers/sandbox-insurer";
import {
  buildPremiumSchedule, isQuoteExpired, maskPolicyNumber, renewalReminderDate, scheduleTotalMinor,
} from "../../apps/web/lib/insurance/calculations";
import { insuranceConsentSchema, insuranceWebhookSchema } from "../../packages/validation/src/index";

const TEST_SECRET = process.env.AUTH_SECRET ?? "unit-test-auth-secret-at-least-32-characters";
process.env.AUTH_SECRET = TEST_SECRET;
process.env.DATABASE_URL ??= "postgresql://nexuspay:test@localhost:5433/nexus_pay";

const adapter = new SandboxInsurerAdapter();

describe("sandbox provider declaration", () => {
  it("declares every capability explicitly and is clearly labelled as sandbox", () => {
    expect(adapter.mode).toBe("SANDBOX");
    expect(adapter.code).toBe("sandbox-insurer");
    expect(adapter.getCapabilities()).toEqual({
      catalogue: true, productDetails: true, quotes: true, applications: true, documents: true,
      policyStatus: true, renewals: true, claims: true, webhooks: true,
    });
    expect(adapter.getProviderDetails().name.toLowerCase()).toContain("sandbox");
    expect(SANDBOX_INSURER_NOTICE.toLowerCase()).toContain("no insurer");
  });

  it("normalizes products with integer minor units and no fabricated regulatory claims", async () => {
    const products = await adapter.getProducts();
    expect(products.length).toBeGreaterThan(0);
    for (const product of products) {
      expect(Number.isInteger(product.coverageMinor)).toBe(true);
      expect(Number.isInteger(product.premiumMinor)).toBe(true);
      expect(product.exclusions?.length).toBeGreaterThan(0);
      expect(product.summary.toLowerCase()).not.toContain("irdai approved");
      expect(product.sourceUpdatedAt).toBeInstanceOf(Date);
    }
    expect(products.some((product) => product.category === "HEALTH")).toBe(true);
    expect(products.some((product) => product.category === "TERM_LIFE")).toBe(true);
  });

  it("returns quote, application, policy and claim fixtures without fabricating real coverage", async () => {
    const products = await adapter.getProducts();
    const quote = await adapter.createQuote({ productCode: products[0]!.code, answers: { age: 30 } });
    expect(quote.premiumMinor).toBeGreaterThan(0);
    expect(quote.validUntil.getTime()).toBeGreaterThan(Date.now());
    const application = await adapter.submitApplication({ productCode: products[0]!.code, applicant: {}, idempotencyKey: "unit-test-key-1" });
    expect(application.status).toBe("SUBMITTED");
    expect(application.providerRef).toMatch(/^ins_/);
    const policy = await adapter.getPolicyDetails(application.providerRef);
    expect(policy?.policyNumberMasked).toContain("XXXX");
    expect(policy?.status).toBe("ACTIVE");
    const claim = await adapter.initiateClaim(application.providerRef, "HEALTH");
    expect(claim?.status).toBe("DRAFT");
  });
});

describe("webhook signature verification (documented HMAC-SHA256 method)", () => {
  const timestamp = "1700000000";
  const payload = { eventType: "CLAIM_SETTLED", providerRef: "ins_abc" };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", TEST_SECRET).update(`${timestamp}.${rawBody}`).digest("hex");

  it("accepts a correctly signed event", () => {
    expect(adapter.verifyWebhook({ signature, timestamp, rawBody })).toBe(true);
  });

  it("rejects a tampered body or invalid signature", () => {
    expect(adapter.verifyWebhook({ signature, timestamp, rawBody: `${rawBody} ` })).toBe(false);
    expect(adapter.verifyWebhook({ signature: "deadbeef", timestamp, rawBody })).toBe(false);
  });

  it("validates webhook event structure before processing", () => {
    const parsed = insuranceWebhookSchema.parse({
      eventType: "CLAIM_SETTLED", eventId: "evt-1", signature, timestamp,
      payload,
    });
    expect(parsed.eventId).toBe("evt-1");
    expect(() => insuranceWebhookSchema.parse({ ...parsed, eventId: "" })).toThrow();
  });
});

describe("consent validation", () => {
  it("requires a provider, purpose, categories and version", () => {
    const consent = insuranceConsentSchema.parse({
      providerId: "provider-1", purpose: "Quote request", dataCategories: ["QUOTE_INPUTS"],
      sharedFields: ["age"], version: "sandbox-v1",
    });
    expect(consent.dataCategories).toEqual(["QUOTE_INPUTS"]);
    expect(() => insuranceConsentSchema.parse({ ...consent, dataCategories: [] })).toThrow();
  });
});

describe("premium and renewal calculations", () => {
  it("builds a yearly schedule with integer minor units", () => {
    const rows = buildPremiumSchedule({
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2028-01-01T00:00:00.000Z"),
      amountMinor: 8_000_00,
      frequency: "YEARLY",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dueDate).toBe("2026-01-01T00:00:00.000Z");
    expect(scheduleTotalMinor(rows)).toBe(1_600_000);
  });

  it("returns no schedule for invalid inputs", () => {
    expect(buildPremiumSchedule({
      startDate: new Date("2026-01-01"), endDate: new Date("2026-01-01"), amountMinor: 1, frequency: "YEARLY",
    })).toEqual([]);
    expect(buildPremiumSchedule({
      startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), amountMinor: 1, frequency: "UNKNOWN",
    })).toEqual([]);
  });

  it("computes reminder dates and masks policy numbers", () => {
    expect(renewalReminderDate(new Date("2026-12-31T00:00:00.000Z"), 30)).toBe("2026-12-01T00:00:00.000Z");
    expect(maskPolicyNumber("ABC123456789")).toBe("AB-XXXX-6789");
    expect(maskPolicyNumber("12")).toBe("XXXX");
  });

  it("treats null validity as expired", () => {
    expect(isQuoteExpired(null)).toBe(true);
    expect(isQuoteExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isQuoteExpired(new Date(Date.now() + 100_000))).toBe(false);
  });
});
