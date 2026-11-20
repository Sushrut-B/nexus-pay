import type { BillCategory, BillerType } from "@nexus/database";

export interface BillerCapabilities {
  categories: boolean;
  billers: boolean;
  billerDetails: boolean;
  billFetch: boolean;
  billPayment: boolean;
  recharge: boolean;
  plans: boolean;
  validation: boolean;
  refunds: boolean;
  complaints: boolean;
  webhooks: boolean;
}

export interface BillerData {
  code: string;
  name: string;
  category: BillCategory;
  billerType: BillerType;
  coverage?: string;
  canFetchBill: boolean;
  canPayBill: boolean;
  supportsRecharge: boolean;
  supportedModes?: string[];
  parameters: Array<{ name: string; label: string; required: boolean; validation?: Record<string, unknown>; sensitive?: boolean }>;
  /** Internal collection username used only by the sandbox to settle through the existing engine. */
  collectionUsername?: string;
  retrievedAt: Date;
}

export interface BillFetchData {
  providerRef: string;
  billNumber?: string;
  billPeriod?: string;
  billDate?: Date;
  dueDate?: Date;
  amountMinor: number;
  minAmountMinor?: number;
  lateFeeMinor?: number;
  extraChargesMinor?: number;
  status?: string;
  validUntil?: Date;
  rawPayload?: Record<string, unknown>;
}

export interface BillPaymentData {
  providerRef: string;
  status: string;
  acceptedAt?: Date;
  rawPayload?: Record<string, unknown>;
}

export interface RechargePlanData {
  code: string;
  name: string;
  priceMinor: number;
  validity?: string;
  dataAllowance?: string;
  benefits?: string[];
  terms?: string;
}

export interface BillerAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: BillerCapabilities;
  getProviderDetails(): { name: string; mode: string; capabilities: BillerCapabilities };
  getCapabilities(): BillerCapabilities;
  getCategories(): BillCategory[];
  getBillers(): Promise<BillerData[]>;
  getBillerDetails(code: string): Promise<BillerData | null>;
  getRequiredParameters(code: string): Promise<BillerData["parameters"]>;
  validateCustomerDetails(code: string, parameters: Record<string, string>): Promise<{ valid: boolean; message?: string }>;
  fetchBill(code: string, parameters: Record<string, string>): Promise<BillFetchData | null>;
  verifyBill(code: string, providerRef: string): Promise<BillFetchData | null>;
  initiatePayment(input: {
    billerCode: string; providerRequestRef: string; providerBillRef?: string; amountMinor: number; parameters: Record<string, string>;
  }): Promise<BillPaymentData | null>;
  getPaymentStatus(providerRef: string): Promise<BillPaymentData | null>;
  getTransactionStatus(providerRef: string): Promise<BillPaymentData | null>;
  requestRefundOrReversal(providerRef: string): Promise<BillPaymentData | null>;
  getComplaintStatus(providerRef: string): Promise<{ status: string; reference: string } | null>;
  getPlans(billerCode: string): Promise<RechargePlanData[]>;
  initiateRecharge(input: { billerCode: string; providerRequestRef: string; amountMinor: number; planCode?: string; parameters: Record<string, string> }): Promise<BillPaymentData | null>;
  getRechargeStatus(providerRef: string): Promise<BillPaymentData | null>;
  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean;
}
