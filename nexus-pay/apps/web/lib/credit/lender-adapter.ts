export interface LenderCapabilities {
  catalogue: boolean;
  eligibility: boolean;
  applicationSubmission: boolean;
  documents: boolean;
  status: boolean;
  offerAcceptance: boolean;
  disbursementConfirmation: boolean;
  repaymentSchedule: boolean;
  webhooks: boolean;
}

export interface LenderProductData {
  code: string;
  name: string;
  type: "PERSONAL" | "CONSUMER_DURABLE" | "EDUCATION" | "VEHICLE" | "BUSINESS" | "SECURED" | "CREDIT_LINE" | "OTHER";
  minAmountMinor: number;
  maxAmountMinor: number;
  interestRateBps: number;
  interestRateType: "REDUCING_BALANCE" | "FLAT" | "VARIABLE" | "PROVIDER_DEFINED";
  aprBps?: number;
  minTenureMonths: number;
  maxTenureMonths: number;
  processingFeeMinor?: number;
  processingFeeBps?: number;
  otherChargesMinor?: number;
  repaymentFrequency?: string;
  eligibilityCriteria?: Record<string, unknown>;
  prepaymentTerms?: string;
  latePaymentTerms?: string;
  requiredDocuments?: string[];
  terms?: string;
  validFrom: Date;
  validTo: Date;
}

export interface LenderOfferData {
  providerOfferRef: string;
  productCode: string;
  amountMinor: number;
  interestRateBps: number;
  aprBps?: number;
  tenureMonths: number;
  emiMinor?: number;
  totalRepaymentMinor?: number;
  totalInterestMinor?: number;
  feesMinor: number;
  expiresAt: Date;
  terms: Record<string, unknown>;
}

export interface LenderEligibilityInput {
  productCode: string;
  answers: Record<string, unknown>;
  observedData?: Record<string, unknown>;
}

export interface LenderEligibilityResult {
  outcome: "PRE_ASSESSMENT_ONLY" | "PROVIDER_ELIGIBLE" | "PROVIDER_INELIGIBLE";
  explanation: string;
  providerRef?: string;
}

export interface LenderApplicationInput {
  idempotencyKey: string;
  productCode: string;
  offerRef: string;
  applicant: Record<string, unknown>;
}

export interface LenderApplicationResult {
  providerApplicationRef: string;
  status: "SUBMITTED" | "ACKNOWLEDGED";
}

export interface LenderRepaymentRow {
  installmentNo: number;
  dueDate: Date;
  principalMinor: number;
  interestMinor: number;
  feesMinor: number;
  totalMinor: number;
  providerRef: string;
}

export interface LenderAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: LenderCapabilities;
  fetchProducts(): Promise<LenderProductData[]>;
  fetchOffers(productCode: string): Promise<LenderOfferData[]>;
  assessEligibility(input: LenderEligibilityInput): Promise<LenderEligibilityResult>;
  submitApplication(input: LenderApplicationInput): Promise<LenderApplicationResult>;
  getApplicationStatus(providerApplicationRef: string): Promise<string>;
  fetchRepaymentSchedule(providerLoanRef: string): Promise<LenderRepaymentRow[]>;
  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean;
}
