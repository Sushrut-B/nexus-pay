/** Release 17 — Tax Centre transport contracts. All figures are estimates in integer paise. */

export const TAX_REGIMES = ["OLD", "NEW"] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_INCOME_CATEGORIES = [
  "SALARY", "BUSINESS", "INTEREST", "DIVIDEND", "RENTAL", "CAPITAL_GAINS",
  "OTHER", "PENSION", "FOREIGN", "USER_DECLARED",
] as const;
export type TaxIncomeCategory = (typeof TAX_INCOME_CATEGORIES)[number];

export const TAX_CLASSIFICATIONS = [
  "UNCLASSIFIED", "POTENTIALLY_TAXABLE", "TAX_EXEMPT", "TAXABLE",
  "NON_TAXABLE", "REQUIRES_REVIEW", "USER_CONFIRMED",
] as const;
export type TaxClassification = (typeof TAX_CLASSIFICATIONS)[number];

export interface TaxFinancialYearView {
  id: string; financialYear: string; assessmentYear: string; status: string;
}

export interface TaxIncomeView {
  id: string; financialYear: string; category: TaxIncomeCategory; classification: TaxClassification;
  sourceType: string; sourceModule: string; sourceRef: string | null; description: string;
  amountMinor: number; occurredAt: string; userConfirmed: boolean; assumptions: string | null;
}

export interface TaxDashboardView {
  financialYear: string; assessmentYear: string; ruleSetVersion: string;
  estimatedIncomeMinor: number; taxableMinor: number; estimatedTaxMinor: number;
  verifiedTaxPaidMinor: number; remainingMinor: number; deductionMinor: number;
  capitalGainMinor: number; documentCompletionBps: number; upcomingDeadlines: number;
  status: string; notice: string; currency: string;
}

export interface TaxCalculationView {
  id: string; financialYear: string; regime: TaxRegime; ruleSetVersion: string;
  status: string; grossMinor: number; taxableMinor: number;
  taxBeforeCreditsMinor: number; rebateMinor: number; surchargeMinor: number;
  cessMinor: number; creditsMinor: number; netTaxMinor: number;
  assumptions: string[]; lineItems: Array<{ code: string; label: string; amountMinor: number; detail: string | null }>;
  createdAt: string;
}

export interface TaxRegimeComparisonView {
  financialYear: string; ruleSetVersion: string;
  old: TaxCalculationView; new: TaxCalculationView; differenceMinor: number;
  materialDrivers: string[]; notice: string;
}

export interface TaxCapitalGainView {
  id: string; financialYear: string; assetType: string; gainType: string;
  purchaseDate: string | null; saleDate: string; saleMinor: number;
  costMinor: number | null; gainMinor: number; completeness: string;
}

export interface TaxCapitalGainsSummary {
  realizedMinor: number; unrealizedMinor: number; shortTermMinor: number;
  longTermMinor: number; lossesMinor: number; incompleteCount: number;
  items: TaxCapitalGainView[]; notice: string;
}

export interface TaxDeductionView {
  id: string; financialYear: string; ruleCode: string; section: string;
  label: string; amountMinor: number; regime: TaxRegime; verified: boolean;
  includeInEstimate: boolean; sourceType: string; note: string | null;
}

export interface TaxCreditView {
  id: string; financialYear: string; kind: string; amountMinor: number;
  verified: boolean; status: string; sourceType: string;
}

export interface TaxDocumentView {
  id: string; financialYear: string; kind: string; fileName: string;
  contentType: string; sizeBytes: number; status: string; extractedFields: number;
  createdAt: string;
}

export interface TaxReconciliationView {
  id: string; financialYear: string; category: string; sourceRef: string;
  amountMinor: number; matchLevel: string; matchedRef: string | null;
  status: string; note: string | null;
}

export interface TaxScenarioView {
  id: string; financialYear: string; name: string; assumptions: Record<string, number>;
  result: Record<string, number>; createdAt: string;
}

export interface TaxDeadlineView {
  id: string; financialYear: string; code: string; title: string;
  dueDate: string; sourceRef: string; status: string;
}

export interface TaxReportView {
  id: string; title: string; format: string; fileName: string; createdAt: string;
}

export interface TaxFilingReadinessView {
  financialYear: string; items: Array<{ code: string; label: string; status: "COMPLETE" | "INCOMPLETE" | "REQUIRES_REVIEW" | "NOT_APPLICABLE" }>;
  completionBps: number; notice: string;
}

export interface TaxOperationsView {
  ruleSets: number; publishedRuleSets: number; calculations: number;
  failedJobs: number; documents: number; failedDocuments: number;
  reconciliationExceptions: number; remindersSent: number; currency: string;
}
