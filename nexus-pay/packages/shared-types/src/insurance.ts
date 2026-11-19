/** Release 12 — Insurance marketplace transport contracts. */

export const INSURANCE_CATEGORIES = [
  "HEALTH", "LIFE", "TERM_LIFE", "MOTOR", "TWO_WHEELER", "CAR", "TRAVEL",
  "PERSONAL_ACCIDENT", "HOME", "OTHER",
] as const;
export type InsuranceCategory = (typeof INSURANCE_CATEGORIES)[number];

export interface InsuranceProviderView {
  id: string; code: string; displayName: string; mode: string; status: string;
  capabilities: Record<string, boolean>; available: boolean; lastSyncAt: string | null; notice: string;
}

export interface InsuranceProductView {
  id: string; providerId: string; providerName: string; code: string; name: string;
  category: InsuranceCategory; summary: string; coverageSummary: string | null;
  coverageMinor: number | null; premiumMinor: number | null; premiumFrequency: string;
  durationMonths: number | null; benefits: string[]; exclusions: string[];
  waitingPeriods: string[]; eligibility: string[]; deductibles: string[]; addons: string[];
  claimProcess: string | null; renewalTerms: string | null; documents: Array<{ name: string; url: string; type: string }>;
  source: string; sourceUpdatedAt: string; isSandbox: boolean;
}

export interface InsuranceComparisonView {
  products: InsuranceProductView[];
  category: InsuranceCategory;
  missingFields: string[];
  comparisonAt: string;
  notice: string;
}

export interface InsuranceQuoteView {
  id: string; productId: string; providerName: string; status: string;
  providerRef: string | null; premiumMinor: number | null; coverageMinor: number | null;
  premiumBreakdown: Record<string, number>; validUntil: string | null;
  createdAt: string; isEstimate: boolean; notice: string;
}

export interface InsuranceApplicationView {
  id: string; productId: string; quoteId: string | null; providerName: string; status: string;
  providerRef: string | null; submittedAt: string | null; completedAt: string | null;
  lastError: string | null; documentCount: number; createdAt: string; isSandbox: boolean;
}

export interface InsurancePolicyView {
  id: string; providerName: string; policyNumberMasked: string; category: InsuranceCategory;
  coverageMinor: number; premiumMinor: number; premiumFrequency: string;
  startDate: string; endDate: string; renewalDate: string | null; status: string;
  providerReportedAt: string; isSandbox: boolean;
}

export interface InsurancePremiumView {
  id: string; installmentNo: number; dueDate: string; amountMinor: number; status: string;
  providerPaymentRef: string | null; gracePeriodDays: number; lastSyncAt: string;
}

export interface InsuranceRenewalView {
  id: string; policyId: string; status: string; renewalDate: string; userConfirmed: boolean;
  quoteRef: string | null; documentRef: string | null;
}

export interface InsuranceClaimView {
  id: string; policyId: string; providerName: string; providerRef: string; claimType: string;
  incidentDate: string; status: string; submittedAt: string | null;
  requestedDocuments: string[]; lastUpdate: string; documentCount: number;
}

export interface InsuranceConsentView {
  id: string; providerName: string; purpose: string; dataCategories: string[];
  sharedFields: string[]; version: string; status: string; createdAt: string; revokedAt: string | null;
}

export interface InsuranceDocumentView {
  id: string; ownerType: string; ownerId: string; category: string; fileName: string;
  contentType: string; sizeBytes: number; status: string; scanStatus: string; uploadedAt: string;
}

export interface InsuranceActivityView {
  id: string; type: string; title: string; body: string | null; reference: string | null; createdAt: string;
}

export interface InsurancePreferenceView {
  quoteNotifications: boolean; applicationNotifications: boolean; policyNotifications: boolean;
  premiumReminders: boolean; renewalReminders: boolean; claimNotifications: boolean;
}

export interface InsuranceOverviewView {
  providers: number; products: number; policies: number; pendingApplications: number;
  upcomingRenewals: number; claimsInProgress: number; upcomingPremiums: number;
  currency: string; notice: string;
}

export interface InsuranceOperationsView {
  providers: number; products: number; applications: number; policies: number;
  claims: number; webhookFailures: number; syncBacklog: number; lastSyncAt: string | null;
  currency: string;
}
