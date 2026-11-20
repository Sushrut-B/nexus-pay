import { createHash, createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type {
  BillerAdapter, BillerCapabilities, BillerData, BillFetchData, BillPaymentData, RechargePlanData,
} from "@/lib/billing/biller-adapter";

export const SANDBOX_BILLER_NOTICE =
  "SANDBOX DEMONSTRATION ONLY — no biller, provider, BBPS/Bharat Connect participation or regulatory authorization exists. Bills, plans, payments and confirmations below are test fixtures, not real utility services.";

const CAPABILITIES: BillerCapabilities = {
  categories: true, billers: true, billerDetails: true, billFetch: true, billPayment: true,
  recharge: true, plans: true, validation: true, refunds: false, complaints: false, webhooks: true,
};

function ref(seed: string): string {
  return `bill_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

function collectionUsername(code: string): string {
  return `billpay_${code.replace(/[^a-z0-9]/gi, "_").toLowerCase()}`.slice(0, 30);
}

/** Clearly labelled test provider. Enabled only by NEXUS_BILLING_SANDBOX_ENABLED. */
export class SandboxBillerAdapter implements BillerAdapter {
  readonly code = "sandbox-biller";
  readonly displayName = "Sandbox Demonstration Biller Provider";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  getProviderDetails() { return { name: this.displayName, mode: this.mode, capabilities: this.capabilities }; }
  getCapabilities() { return this.capabilities; }
  getCategories() {
    return ["ELECTRICITY", "WATER", "BROADBAND", "MOBILE_POSTPAID", "MOBILE_PREPAID", "DTH", "FASTAG", "GAS", "SOCIETY_MAINTENANCE"] as const as never;
  }

  async getBillers(): Promise<BillerData[]> {
    const now = new Date();
    const common = [{ name: "consumerNumber", label: "Consumer number", required: true, sensitive: false }];
    return [
      { code: "sandbox-electricity", name: "Sandbox Electricity (test fixture)", category: "ELECTRICITY", billerType: "POSTPAID", coverage: "Test region only", canFetchBill: true, canPayBill: true, supportsRecharge: false, supportedModes: ["WALLET"], parameters: common, collectionUsername: collectionUsername("sandbox-electricity"), retrievedAt: now },
      { code: "sandbox-water", name: "Sandbox Water Board (test fixture)", category: "WATER", billerType: "POSTPAID", coverage: "Test region only", canFetchBill: true, canPayBill: true, supportsRecharge: false, supportedModes: ["WALLET"], parameters: common, collectionUsername: collectionUsername("sandbox-water"), retrievedAt: now },
      { code: "sandbox-broadband", name: "Sandbox Broadband (test fixture)", category: "BROADBAND", billerType: "POSTPAID", coverage: "Test region only", canFetchBill: true, canPayBill: true, supportsRecharge: false, supportedModes: ["WALLET"], parameters: common, collectionUsername: collectionUsername("sandbox-broadband"), retrievedAt: now },
      { code: "sandbox-mobile-prepaid", name: "Sandbox Mobile Prepaid (test fixture)", category: "MOBILE_PREPAID", billerType: "PREPAID", coverage: "Test region only", canFetchBill: false, canPayBill: false, supportsRecharge: true, supportedModes: ["WALLET"], parameters: [{ name: "mobileNumber", label: "Registered mobile number", required: true, sensitive: true }], collectionUsername: collectionUsername("sandbox-mobile-prepaid"), retrievedAt: now },
      { code: "sandbox-fastag", name: "Sandbox FASTag (test fixture)", category: "FASTAG", billerType: "PREPAID", coverage: "Test region only", canFetchBill: false, canPayBill: false, supportsRecharge: true, supportedModes: ["WALLET"], parameters: [{ name: "vehicleNumber", label: "Vehicle registration", required: true, sensitive: false }], collectionUsername: collectionUsername("sandbox-fastag"), retrievedAt: now },
    ];
  }

  async getBillerDetails(code: string) { return (await this.getBillers()).find((b) => b.code === code) ?? null; }
  async getRequiredParameters(code: string) { return (await this.getBillerDetails(code))?.parameters ?? []; }

  async validateCustomerDetails(code: string, parameters: Record<string, string>) {
    const biller = await this.getBillerDetails(code);
    if (!biller) return { valid: false, message: "Unknown sandbox biller" };
    const missing = biller.parameters.filter((p) => p.required && !parameters[p.name]?.trim());
    return { valid: missing.length === 0, message: missing.length ? `Missing ${missing.map((p) => p.label).join(", ")}` : undefined };
  }

  async fetchBill(code: string, parameters: Record<string, string>): Promise<BillFetchData | null> {
    const validity = await this.validateCustomerDetails(code, parameters);
    if (!validity.valid || !["sandbox-electricity", "sandbox-water", "sandbox-broadband"].includes(code)) return null;
    const due = new Date(Date.now() + 7 * 86_400_000);
    return {
      providerRef: ref(`bill:${code}:${JSON.stringify(parameters)}`),
      billNumber: `TESTBILL-${code.slice(-4).toUpperCase()}`,
      billPeriod: "2026-11",
      billDate: new Date(Date.now() - 7 * 86_400_000),
      dueDate: due,
      amountMinor: 2_450_00,
      minAmountMinor: 1_000_00,
      lateFeeMinor: 0,
      extraChargesMinor: 0,
      status: "FETCHED",
      validUntil: new Date(Date.now() + 2 * 86_400_000),
      rawPayload: { test: true, code, notice: SANDBOX_BILLER_NOTICE },
    };
  }

  async verifyBill(code: string, providerRef: string) {
    const bill = await this.fetchBill(code, { providerRef });
    return bill ? { ...bill, providerRef } : null;
  }

  async initiatePayment(input: { billerCode: string; providerRequestRef: string; providerBillRef?: string; amountMinor: number }): Promise<BillPaymentData> {
    return {
      providerRef: ref(`payment:${input.providerRequestRef}`),
      status: "ACCEPTED",
      acceptedAt: new Date(),
      rawPayload: { test: true, notice: SANDBOX_BILLER_NOTICE, providerRequestRef: input.providerRequestRef },
    };
  }

  async getPaymentStatus(providerRef: string): Promise<BillPaymentData> {
    return { providerRef, status: "BILLER_CONFIRMED", acceptedAt: new Date() };
  }
  async getTransactionStatus(providerRef: string) { return this.getPaymentStatus(providerRef); }
  async requestRefundOrReversal() { return null; } // refunds unsupported by the sandbox
  async getComplaintStatus() { return null; }

  async getPlans(billerCode: string): Promise<RechargePlanData[]> {
    if (billerCode !== "sandbox-mobile-prepaid") return [];
    return [
      { code: "test-plan-199", name: "Sandbox Test Plan 199 (fixture)", priceMinor: 199_00, validity: "28 days", dataAllowance: "Test allowance", benefits: ["Test benefit"], terms: SANDBOX_BILLER_NOTICE },
      { code: "test-plan-399", name: "Sandbox Test Plan 399 (fixture)", priceMinor: 399_00, validity: "56 days", dataAllowance: "Test allowance", benefits: ["Test benefit"], terms: SANDBOX_BILLER_NOTICE },
    ];
  }

  async initiateRecharge(input: { billerCode: string; providerRequestRef: string; amountMinor: number }): Promise<BillPaymentData> {
    return { providerRef: ref(`recharge:${input.providerRequestRef}`), status: "ACCEPTED", acceptedAt: new Date(), rawPayload: { test: true } };
  }
  async getRechargeStatus(providerRef: string): Promise<BillPaymentData> {
    return { providerRef, status: "SUCCESS", acceptedAt: new Date() };
  }

  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean {
    const expected = createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
    return expected === input.signature;
  }
}

export { CAPABILITIES as SANDBOX_BILLER_CAPABILITIES };

