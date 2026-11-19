import type { InsuranceProductCategory } from "@nexus/database";

export interface InsurerCapabilities {
  catalogue: boolean;
  productDetails: boolean;
  quotes: boolean;
  applications: boolean;
  documents: boolean;
  policyStatus: boolean;
  renewals: boolean;
  claims: boolean;
  webhooks: boolean;
}

export interface InsurerProductData {
  code: string;
  name: string;
  category: InsuranceProductCategory;
  summary: string;
  coverageSummary?: string;
  coverageMinor?: number;
  premiumMinor?: number;
  premiumFrequency?: string;
  durationMonths?: number;
  benefits?: string[];
  exclusions?: string[];
  waitingPeriods?: string[];
  eligibility?: string[];
  deductibles?: string[];
  addons?: string[];
  claimProcess?: string;
  renewalTerms?: string;
  documents?: Array<{ name: string; url: string; type: string }>;
  sourceUpdatedAt: Date;
}

export interface InsurerQuoteInput {
  productCode: string;
  answers: Record<string, unknown>;
}

export interface InsurerQuoteData {
  providerRef: string;
  premiumMinor: number;
  premiumBreakdown: Record<string, number>;
  coverageMinor?: number;
  validUntil: Date;
  metadata: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
}

export interface InsurerApplicationInput {
  productCode: string;
  quoteRef?: string;
  applicant: Record<string, unknown>;
  idempotencyKey: string;
}

export interface InsurerApplicationResult {
  providerRef: string;
  status: string;
}

export interface InsurerPolicyData {
  providerRef: string;
  policyNumberMasked: string;
  status: string;
  coverageMinor: number;
  premiumMinor: number;
  startDate: Date;
  endDate: Date;
  nominee?: Record<string, unknown>;
  providerContact?: Record<string, unknown>;
}

export interface InsurerClaimData {
  providerRef: string;
  status: string;
  requestedDocuments?: string[];
  lastUpdate: Date;
}

export interface InsurerAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: InsurerCapabilities;
  getProviderDetails(): { name: string; mode: string; capabilities: InsurerCapabilities };
  getCapabilities(): InsurerCapabilities;
  getProducts(): Promise<InsurerProductData[]>;
  getProductDetails(code: string): Promise<InsurerProductData | null>;
  createQuote(input: InsurerQuoteInput): Promise<InsurerQuoteData>;
  getQuote(providerRef: string): Promise<InsurerQuoteData | null>;
  submitApplication(input: InsurerApplicationInput): Promise<InsurerApplicationResult>;
  getApplicationStatus(providerRef: string): Promise<string>;
  getPolicyDetails(providerRef: string): Promise<InsurerPolicyData | null>;
  getPolicyDocuments(providerRef: string): Promise<Array<{ name: string; url: string; type: string }>>;
  getRenewalDetails(providerRef: string): Promise<{ renewalDate: Date; quoteRef?: string; status: string } | null>;
  initiateClaim(policyRef: string, claimType: string): Promise<InsurerClaimData | null>;
  getClaimStatus(claimRef: string): Promise<InsurerClaimData | null>;
  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean;
}
