import { createHash, createHmac, randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type {
  InsurerAdapter, InsurerApplicationInput, InsurerApplicationResult, InsurerCapabilities,
  InsurerClaimData, InsurerPolicyData, InsurerProductData, InsurerQuoteData, InsurerQuoteInput,
} from "@/lib/insurance/insurer-adapter";

export const SANDBOX_INSURER_NOTICE =
  "SANDBOX DEMONSTRATION ONLY — no insurer, broker, web aggregator or IRDAI authorization exists. Products, quotes, policies and claims below are test fixtures, not real coverage.";

const CAPABILITIES: InsurerCapabilities = {
  catalogue: true, productDetails: true, quotes: true, applications: true, documents: true,
  policyStatus: true, renewals: true, claims: true, webhooks: true,
};

function ref(seed: string): string {
  return `ins_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

/** Clearly labelled test insurer. Enabled only by NEXUS_INSURANCE_SANDBOX_ENABLED. */
export class SandboxInsurerAdapter implements InsurerAdapter {
  readonly code = "sandbox-insurer";
  readonly displayName = "Sandbox Demonstration Insurer";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  getProviderDetails() {
    return { name: this.displayName, mode: this.mode, capabilities: this.capabilities };
  }
  getCapabilities() { return this.capabilities; }

  async getProducts(): Promise<InsurerProductData[]> {
    const now = new Date();
    return [
      {
        code: "sandbox-health",
        name: "Sandbox Health Shield (test fixture)",
        category: "HEALTH",
        summary: "Illustrative health product used only to exercise the sandbox workflow.",
        coverageSummary: "Test coverage up to ₹5,00,000. No real insurance is provided.",
        coverageMinor: 500_000_00,
        premiumMinor: 8_000_00,
        premiumFrequency: "YEARLY",
        durationMonths: 12,
        benefits: ["Test benefit A", "Test benefit B"],
        exclusions: ["ALL EXCLUSIONS ARE ILLUSTRATIVE", "Not real coverage"],
        waitingPeriods: ["Illustrative 30-day waiting period"],
        eligibility: ["Sandbox test users only"],
        deductibles: ["Illustrative deductible"],
        addons: ["Test add-on"],
        claimProcess: SANDBOX_INSURER_NOTICE,
        renewalTerms: SANDBOX_INSURER_NOTICE,
        documents: [{ name: "Sandbox product disclosure (test)", url: "https://example.invalid/sandbox", type: "PRODUCT_DISCLOSURE" }],
        sourceUpdatedAt: now,
      },
      {
        code: "sandbox-term",
        name: "Sandbox Term Life (test fixture)",
        category: "TERM_LIFE",
        summary: "Illustrative term-life product. No real policy is issued.",
        coverageSummary: "Test sum assured ₹10,00,000.",
        coverageMinor: 1_000_000_00,
        premiumMinor: 4_000_00,
        premiumFrequency: "YEARLY",
        durationMonths: 12,
        benefits: ["Test benefit"],
        exclusions: ["Not real coverage"],
        waitingPeriods: [],
        eligibility: ["Sandbox test users only"],
        deductibles: [],
        addons: [],
        claimProcess: SANDBOX_INSURER_NOTICE,
        renewalTerms: SANDBOX_INSURER_NOTICE,
        documents: [],
        sourceUpdatedAt: now,
      },
    ];
  }

  async getProductDetails(code: string) {
    return (await this.getProducts()).find((product) => product.code === code) ?? null;
  }

  async createQuote(input: InsurerQuoteInput): Promise<InsurerQuoteData> {
    const product = await this.getProductDetails(input.productCode);
    if (!product) throw new Error("Unknown sandbox product");
    const premium = product.premiumMinor ?? 0;
    return {
      providerRef: ref(`quote:${input.productCode}:${JSON.stringify(input.answers)}:${randomUUID()}`),
      premiumMinor: premium,
      premiumBreakdown: { base: premium, taxes: 0, fees: 0 },
      coverageMinor: product.coverageMinor,
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      metadata: { notice: SANDBOX_INSURER_NOTICE, estimated: false },
      rawPayload: { test: true, productCode: input.productCode },
    };
  }

  async getQuote(providerRef: string): Promise<InsurerQuoteData | null> {
    return {
      providerRef,
      premiumMinor: 8_000_00,
      premiumBreakdown: { base: 8_000_00 },
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      metadata: { notice: SANDBOX_INSURER_NOTICE },
    };
  }

  async submitApplication(input: InsurerApplicationInput): Promise<InsurerApplicationResult> {
    return {
      providerRef: ref(`application:${input.idempotencyKey}`),
      status: "SUBMITTED",
    };
  }

  async getApplicationStatus(providerRef: string): Promise<string> {
    return parseInt(providerRef.slice(-2), 16) % 2 === 0 ? "UNDER_REVIEW" : "SUBMITTED";
  }

  async getPolicyDetails(providerRef: string): Promise<InsurerPolicyData | null> {
    const now = new Date();
    return {
      providerRef,
      policyNumberMasked: `SBX-XXXX-${providerRef.slice(-4).toUpperCase()}`,
      status: "ACTIVE",
      coverageMinor: 500_000_00,
      premiumMinor: 8_000_00,
      startDate: now,
      endDate: new Date(now.getTime() + 365 * 86_400_000),
      providerContact: { email: "sandbox@example.invalid" },
    };
  }

  async getPolicyDocuments(providerRef: string) {
    return [{ name: "Sandbox policy certificate (test)", url: `https://example.invalid/sandbox/${providerRef}`, type: "POLICY_CERTIFICATE" }];
  }

  async getRenewalDetails(providerRef: string) {
    return { renewalDate: new Date(Date.now() + 340 * 86_400_000), status: "PENDING", quoteRef: ref(`renewal:${providerRef}`) };
  }

  async initiateClaim(policyRef: string, claimType: string): Promise<InsurerClaimData> {
    return {
      providerRef: ref(`claim:${policyRef}:${claimType}`),
      status: "DRAFT",
      requestedDocuments: ["Test document A"],
      lastUpdate: new Date(),
    };
  }

  async getClaimStatus(claimRef: string): Promise<InsurerClaimData> {
    return { providerRef: claimRef, status: "UNDER_REVIEW", lastUpdate: new Date() };
  }

  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean {
    const expected = createHmac("sha256", getServerEnv().AUTH_SECRET)
      .update(`${input.timestamp}.${input.rawBody}`)
      .digest("hex");
    return expected === input.signature;
  }
}

export { CAPABILITIES as SANDBOX_INSURER_CAPABILITIES };
