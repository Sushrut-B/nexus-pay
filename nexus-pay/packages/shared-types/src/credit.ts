/** Release 11 — Credit marketplace and loan management contracts. */

export const LOAN_APPLICATION_STATUSES = [
  "DRAFT", "READY_FOR_SUBMISSION", "SUBMITTED", "ACKNOWLEDGED", "UNDER_REVIEW",
  "ADDITIONAL_INFORMATION_REQUIRED", "APPROVED", "REJECTED", "OFFERED", "ACCEPTED",
  "DISBURSEMENT_PENDING", "DISBURSED", "WITHDRAWN", "EXPIRED", "CANCELLED",
] as const;
export type LoanApplicationStatus = (typeof LOAN_APPLICATION_STATUSES)[number];

export const REPAYMENT_STATUSES = [
  "UPCOMING", "DUE", "PROCESSING", "PAID", "OVERDUE", "FAILED", "WAIVED", "UNKNOWN", "REQUIRES_RECONCILIATION",
] as const;
export type RepaymentStatus = (typeof REPAYMENT_STATUSES)[number];

export interface LendingProviderView {
  id: string;
  code: string;
  displayName: string;
  mode: "SANDBOX" | "PRODUCTION";
  status: string;
  capabilities: Record<string, boolean>;
  available: boolean;
  notice: string;
}

export interface CreditProductView {
  id: string;
  providerId: string;
  providerName: string;
  name: string;
  type: string;
  minAmountMinor: number;
  maxAmountMinor: number;
  interestRateBps: number;
  interestRateType: string;
  aprBps: number | null;
  minTenureMonths: number;
  maxTenureMonths: number;
  processingFeeMinor: number;
  processingFeeBps: number;
  otherChargesMinor: number;
  repaymentFrequency: string;
  prepaymentTerms: string | null;
  latePaymentTerms: string | null;
  requiredDocuments: string[];
  terms: string | null;
  validTo: string;
  source: string;
  isSandbox: boolean;
}

export interface CreditOfferView {
  id: string;
  productId: string;
  providerId: string;
  providerName: string;
  productName: string;
  amountMinor: number;
  interestRateBps: number;
  aprBps: number | null;
  tenureMonths: number;
  emiMinor: number | null;
  totalRepaymentMinor: number | null;
  totalInterestMinor: number | null;
  feesMinor: number;
  expiresAt: string;
  isSandbox: boolean;
  notice: string;
}

export interface ComparisonResult {
  offers: CreditOfferView[];
  method: string;
  assumptions: string[];
  currency: string;
  notice: string;
}

export interface EligibilityResult {
  id: string;
  outcome: "PRE_ASSESSMENT_ONLY" | "PROVIDER_ELIGIBLE" | "PROVIDER_INELIGIBLE" | "INSUFFICIENT_DATA";
  source: string;
  explanation: string;
  observedFields: string[];
  declaredFields: string[];
  providerRef: string | null;
  createdAt: string;
  notice: string;
}

export interface ApplicationView {
  id: string;
  offerId: string;
  productId: string;
  providerId: string;
  providerName: string;
  status: LoanApplicationStatus;
  providerApplicationRef: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  lastError: string | null;
  createdAt: string;
  history: Array<{ from: string | null; to: string; actor: string; at: string; evidence: string | null }>;
  documents: Array<{ id: string; category: string; fileName: string; status: string }>;
  isSandbox: boolean;
}

export interface LoanView {
  id: string;
  userId: string;
  lender: string;
  loanRef: string;
  originalPrincipalMinor: number;
  outstandingPrincipalMinor: number;
  interestRateBps: number;
  aprBps: number | null;
  tenureMonths: number;
  emiMinor: number;
  nextDueDate: string | null;
  totalRepaidMinor: number;
  totalRemainingMinor: number;
  status: string;
  providerReportedAt: string;
  isSandbox: boolean;
}

export interface RepaymentView {
  id: string;
  installmentNo: number;
  dueDate: string;
  principalMinor: number;
  interestMinor: number;
  feesMinor: number;
  totalMinor: number;
  status: RepaymentStatus;
  paymentRef: string | null;
  isProviderReported: boolean;
}

export interface DocumentView {
  id: string;
  category: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  scanStatus: string;
  uploadedAt: string;
}

export interface BorrowingOverviewView {
  activeLoans: number;
  outstandingMinor: number;
  monthlyCommitmentMinor: number;
  upcomingMinor: number;
  completedLoans: number;
  applicationCount: number;
  currency: string;
  notice: string;
}

export interface AffordabilityView {
  id: string;
  amountMinor: number;
  tenureMonths: number;
  interestRateBps: number;
  emiMinor: number;
  currentInflowMinor: number;
  currentOutflowMinor: number;
  commitmentsMinor: number;
  remainingMinor: number;
  assumptions: string[];
  dataCoverageBps: number;
  currency: string;
  notice: string;
}

export interface CreditOperationsView {
  providers: number;
  products: number;
  activeOffers: number;
  applications: number;
  submittedApplications: number;
  callbackFailures: number;
  documentFailures: number;
  loans: number;
  syncBacklog: number;
  currency: string;
}
