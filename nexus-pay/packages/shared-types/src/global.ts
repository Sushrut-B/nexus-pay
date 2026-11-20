/**
 * Release 18 — Global Finance transport contracts.
 *
 * Every monetary figure carries its ORIGINAL currency and integer minor units.
 * Converted values are always estimates at a stated rate/source/as-of time and
 * are never used as wallet balances. See docs/release-18-assessment.md.
 */

export const DISPLAY_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "SGD", "AED", "AUD", "CAD", "JPY", "CHF",
] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** INR is the only transactable Nexus Pay wallet currency. */
export const WALLET_SETTLEMENT_CURRENCY = "INR";

export const RATE_CLASSIFICATIONS = [
  "INDICATIVE", "REFERENCE", "PROVIDER_QUOTE", "EXECUTABLE_QUOTE", "HISTORICAL",
] as const;
export type RateClassification = (typeof RATE_CLASSIFICATIONS)[number];

export const ACCOUNT_CLASSIFICATIONS = [
  "VERIFIED_PROVIDER_DATA", "USER_REPORTED", "SANDBOX_DATA", "ESTIMATED_VALUE",
  "STALE_DATA", "REQUIRES_REVIEW",
] as const;
export type AccountClassification = (typeof ACCOUNT_CLASSIFICATIONS)[number];

export const FX_QUOTE_STATES = [
  "QUOTE_REQUESTED", "QUOTE_RECEIVED", "QUOTE_EXPIRED",
  "CUSTOMER_CONFIRMATION_REQUIRED", "EXECUTION_PENDING", "EXECUTING",
  "COMPLETED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED",
] as const;
export type FxQuoteState = (typeof FX_QUOTE_STATES)[number];

export const TRANSFER_STATES = [
  "CREATED", "BENEFICIARY_VALIDATION_PENDING", "BENEFICIARY_VALIDATED",
  "QUOTE_PENDING", "QUOTE_AVAILABLE", "CUSTOMER_CONFIRMATION_REQUIRED",
  "PAYMENT_PENDING", "PROVIDER_SUBMISSION_PENDING", "PROVIDER_PROCESSING",
  "COMPLETED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED",
  "REFUND_PENDING", "REFUNDED", "CANCELLED",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export const COMPLIANCE_STATES = [
  "NOT_REQUIRED", "INFORMATION_REQUIRED", "VERIFICATION_PENDING", "VERIFIED",
  "REJECTED", "REQUIRES_REVIEW", "EXPIRED",
] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const FOREIGN_EXPENSE_CATEGORIES = [
  "ACCOMMODATION", "FOOD", "TRANSPORT", "SHOPPING", "EDUCATION", "HEALTHCARE",
  "TRAVEL", "ENTERTAINMENT", "SUBSCRIPTIONS", "PROFESSIONAL", "OTHER",
] as const;
export type ForeignExpenseCategory = (typeof FOREIGN_EXPENSE_CATEGORIES)[number];

export interface FxRateView {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  /** Rate as an exact decimal string, e.g. "83.125000". Never a float. */
  rate: string;
  classification: RateClassification;
  providerCode: string;
  sourceRef: string | null;
  asOf: string;
  fetchedAt: string;
  isStale: boolean;
  precision: number;
  notice: string;
}

export interface ConversionView {
  sourceCurrency: string;
  targetCurrency: string;
  originalMinor: number;
  convertedMinor: number;
  rate: string;
  classification: RateClassification;
  providerCode: string;
  rateAsOf: string;
  rounding: string;
  feesIncluded: boolean;
  feeNotice: string;
  notice: string;
}

export interface MultiCurrencyAccountView {
  id: string;
  name: string;
  providerCode: string;
  accountType: string;
  currency: string;
  originalBalanceMinor: number;
  displayBalanceMinor: number | null;
  displayCurrency: string;
  classification: AccountClassification;
  verificationStatus: string;
  connectionStatus: string;
  sourceRef: string | null;
  lastSyncedAt: string | null;
  isWallet: boolean;
  notice: string;
}

export interface CurrencyWatchlistView {
  id: string;
  name: string;
  pairs: Array<{ baseCurrency: string; quoteCurrency: string }>;
  createdAt: string;
}

export interface RateAlertView {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  direction: "ABOVE" | "BELOW" | "CHANGE_PERCENT";
  targetRate: string | null;
  changePercentBps: number | null;
  paused: boolean;
  lastTriggeredAt: string | null;
  classification: RateClassification;
  notice: string;
}

export interface FxQuoteView {
  id: string;
  state: FxQuoteState;
  sourceCurrency: string;
  targetCurrency: string;
  sourceMinor: number;
  targetMinor: number | null;
  rate: string | null;
  classification: RateClassification;
  providerCode: string;
  providerFeeMinor: number | null;
  taxMinor: number | null;
  expiresAt: string | null;
  providerRef: string | null;
  payableMinor: number | null;
  receivableMinor: number | null;
  notice: string;
}

export interface InternationalProviderView {
  code: string;
  displayName: string;
  mode: string;
  available: boolean;
  capabilities: Record<string, boolean>;
  notice: string;
}

export interface CorridorView {
  id: string;
  sourceCountry: string;
  destinationCountry: string;
  sourceCurrency: string;
  targetCurrency: string;
  enabled: boolean;
  providerCode: string;
  notice: string;
}

export interface BeneficiaryView {
  id: string;
  label: string;
  country: string;
  currency: string;
  bankName: string | null;
  accountMasked: string;
  paymentMethod: string;
  providerRef: string | null;
  verificationStatus: ComplianceState;
  createdAt: string;
}

export interface InternationalTransferView {
  id: string;
  state: TransferState;
  beneficiaryId: string;
  sourceCurrency: string;
  targetCurrency: string;
  sourceMinor: number;
  targetMinor: number | null;
  feeMinor: number | null;
  providerCode: string;
  providerRef: string | null;
  complianceState: ComplianceState;
  walletSettlementRef: string | null;
  notice: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForeignExpenseView {
  id: string;
  originalMinor: number;
  originalCurrency: string;
  convertedMinor: number | null;
  displayCurrency: string;
  category: ForeignExpenseCategory;
  merchant: string | null;
  country: string;
  occurredAt: string;
  paymentMethod: string | null;
  exchangeRate: string | null;
  fxFeeMinor: number | null;
  sourceProvider: string;
  verificationStatus: string;
  travelId: string | null;
  notice: string;
}

export interface ForeignAssetLiabilityView {
  id: string;
  kind: "ASSET" | "LIABILITY";
  label: string;
  originalMinor: number;
  originalCurrency: string;
  convertedMinor: number | null;
  displayCurrency: string;
  valuationDate: string;
  rate: string | null;
  rateSource: string | null;
  verificationStatus: string;
  sourceRef: string | null;
  notice: string;
}

export interface TravelCurrencyView {
  tripId: string;
  destination: string | null;
  tripCurrency: string;
  budgetMinor: number | null;
  spentMinor: number;
  convertedSpentMinor: number | null;
  displayCurrency: string;
  cashStartingMinor: number | null;
  cashRemainingMinor: number | null;
  unreconciledCount: number;
  notice: string;
}

export interface GlobalInsightView {
  id: string;
  kind: string;
  title: string;
  detail: string;
  currency: string;
  rateSource: string | null;
  rateAsOf: string | null;
  calculationDate: string;
  methodology: string;
  dataUsed: string[];
}

export interface GlobalDashboardView {
  displayCurrency: string;
  totalAssetsMinor: number;
  foreignAssetExposureMinor: number;
  foreignLiabilityExposureMinor: number;
  recentInternationalExpenseMinor: number;
  recentTravelSpendMinor: number;
  recentMovements: FxRateView[];
  recentForeignTransactions: ForeignExpenseView[];
  accounts: MultiCurrencyAccountView[];
  alerts: RateAlertView[];
  pendingTransfers: InternationalTransferView[];
  currencyAllocation: Array<{ currency: string; percentBps: number; minor: number }>;
  generatedAt: string;
  notice: string;
}
