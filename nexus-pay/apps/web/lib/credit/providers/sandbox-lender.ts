import { createHash, createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { calculateEmi, buildAmortizationSchedule } from "@/lib/credit/calculations";
import type {
  LenderAdapter, LenderApplicationInput, LenderApplicationResult, LenderCapabilities,
  LenderEligibilityInput, LenderEligibilityResult, LenderOfferData, LenderProductData, LenderRepaymentRow,
} from "@/lib/credit/lender-adapter";

export const SANDBOX_LENDER_NOTICE =
  "SANDBOX DEVELOPMENT FIXTURE — no bank, NBFC or Regulated Entity is connected. Offers, eligibility results and application statuses are test data, not credit decisions.";

const CAPABILITIES: LenderCapabilities = {
  catalogue: true, eligibility: true, applicationSubmission: true, documents: true,
  status: true, offerAcceptance: false, disbursementConfirmation: false,
  repaymentSchedule: true, webhooks: true,
};

function ref(seed: string): string {
  return `sandbox_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

/** Clearly labelled test lender. Enabled only by NEXUS_CREDIT_SANDBOX_ENABLED. */
export class SandboxLenderAdapter implements LenderAdapter {
  readonly code = "sandbox-lender";
  readonly displayName = "Sandbox Lending Partner (test only)";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  async fetchProducts(): Promise<LenderProductData[]> {
    return [
      {
        code: "sandbox-personal",
        name: "Sandbox Personal Loan (test fixture)",
        type: "PERSONAL",
        minAmountMinor: 10_000_00,
        maxAmountMinor: 5_000_000_00,
        interestRateBps: 1200,
        interestRateType: "REDUCING_BALANCE",
        minTenureMonths: 6,
        maxTenureMonths: 60,
        processingFeeBps: 100,
        prepaymentTerms: "Test terms only. No real prepayment arrangement exists.",
        latePaymentTerms: "Test terms only. No real late-payment charges apply.",
        requiredDocuments: ["IDENTITY", "INCOME"],
        terms: SANDBOX_LENDER_NOTICE,
        validFrom: new Date(Date.now() - 30 * 86_400_000),
        validTo: new Date(Date.now() + 365 * 86_400_000),
      },
      {
        code: "sandbox-zero",
        name: "Sandbox Zero-Interest Product (test fixture)",
        type: "CONSUMER_DURABLE",
        minAmountMinor: 5_000_00,
        maxAmountMinor: 50_000_00,
        interestRateBps: 0,
        interestRateType: "REDUCING_BALANCE",
        minTenureMonths: 3,
        maxTenureMonths: 12,
        prepaymentTerms: "Test terms only.",
        latePaymentTerms: "Test terms only.",
        requiredDocuments: ["IDENTITY"],
        terms: SANDBOX_LENDER_NOTICE,
        validFrom: new Date(Date.now() - 30 * 86_400_000),
        validTo: new Date(Date.now() + 365 * 86_400_000),
      },
    ];
  }

  async fetchOffers(productCode: string): Promise<LenderOfferData[]> {
    const product = (await this.fetchProducts()).find((item) => item.code === productCode);
    if (!product) return [];
    const amountMinor = Math.min(product.maxAmountMinor, Math.max(product.minAmountMinor, product.minAmountMinor));
    const months = product.minTenureMonths;
    const calculation = calculateEmi(amountMinor, product.interestRateBps, months, product.interestRateType);
    const feesMinor = product.processingFeeMinor ?? Math.round((amountMinor * (product.processingFeeBps ?? 0)) / 10_000);
    return [{
      providerOfferRef: ref(`${productCode}:${amountMinor}:${months}`),
      productCode,
      amountMinor,
      interestRateBps: product.interestRateBps,
      aprBps: product.aprBps,
      tenureMonths: months,
      emiMinor: calculation.emiMinor,
      totalRepaymentMinor: calculation.totalRepaymentMinor,
      totalInterestMinor: calculation.totalInterestMinor,
      feesMinor,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      terms: { notice: SANDBOX_LENDER_NOTICE, method: calculation.method, assumptions: calculation.assumptions },
    }];
  }

  async assessEligibility(input: LenderEligibilityInput): Promise<LenderEligibilityResult> {
    // Deterministic pre-assessment only. Never a credit approval.
    const amount = Number(input.answers.requestedAmountMinor ?? 0);
    const incomeRange = String(input.answers.monthlyIncomeRange ?? "");
    const sufficient = incomeRange !== "BELOW_25000" && amount <= 2_000_000_00;
    return {
      outcome: sufficient ? "PRE_ASSESSMENT_ONLY" : "PRE_ASSESSMENT_ONLY",
      explanation: "This is a clearly labelled internal pre-assessment. No lender decision, approval or bureau score is implied.",
    };
  }

  async submitApplication(input: LenderApplicationInput): Promise<LenderApplicationResult> {
    // Stable reference per idempotency key: repeated calls cannot create duplicates.
    return {
      providerApplicationRef: ref(`application:${input.idempotencyKey}`),
      status: "SUBMITTED",
    };
  }

  async getApplicationStatus(providerApplicationRef: string): Promise<string> {
    const hash = parseInt(providerApplicationRef.slice(-2), 16);
    return hash % 2 === 0 ? "ACKNOWLEDGED" : "UNDER_REVIEW";
  }

  async fetchRepaymentSchedule(providerLoanRef: string): Promise<LenderRepaymentRow[]> {
    const principal = 100_000_00;
    const months = 12;
    const calculation = calculateEmi(principal, 1200, months);
    return buildAmortizationSchedule(principal, 1200, months, calculation.emiMinor).map((row) => ({
      ...row,
      dueDate: new Date(row.dueDate),
      feesMinor: 0,
      providerRef: `${providerLoanRef}:${row.installmentNo}`,
    }));
  }

  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean {
    const expected = createHmac("sha256", getServerEnv().AUTH_SECRET)
      .update(`${input.timestamp}.${input.rawBody}`)
      .digest("hex");
    return expected === input.signature;
  }
}

export { CAPABILITIES as SANDBOX_LENDER_CAPABILITIES };
