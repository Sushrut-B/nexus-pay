/** Release 16 — Investments, portfolio & wealth transport contracts. */

export const INVESTMENT_CATEGORIES = [
  "EQUITY", "DEBT", "HYBRID", "INDEX", "ELSS", "LIQUID",
  "INTERNATIONAL", "SECTORAL", "GOLD", "CASH", "OTHER",
] as const;
export type InvestmentCategory = (typeof INVESTMENT_CATEGORIES)[number];

export const INVESTMENT_CONNECTION_STATUSES = [
  "NOT_CONNECTED", "CONNECTION_INITIATED", "AUTHORIZATION_PENDING", "ACTIVE",
  "SYNCING", "SYNC_FAILED", "CONSENT_EXPIRED", "REVOKED", "DISCONNECTED",
] as const;
export type InvestmentConnectionStatus = (typeof INVESTMENT_CONNECTION_STATUSES)[number];

export const SIP_STATUSES = [
  "ACTIVE", "PAUSED", "CANCELLED", "COMPLETED", "FAILED", "PENDING", "UNKNOWN",
] as const;
export type SIPStatus = (typeof SIP_STATUSES)[number];

export interface InvestmentProviderView {
  id: string; code: string; displayName: string; mode: string; status: string;
  capabilities: Record<string, boolean>; available: boolean; notice: string;
}

export interface InvestmentConnectionView {
  id: string; providerCode: string; status: InvestmentConnectionStatus;
  maskedLabel: string | null; lastSyncAt: string | null; lastError: string | null;
  consentStatus: string | null; consentExpiresAt: string | null;
}

export interface PortfolioHoldingView {
  id: string; accountId: string; name: string; category: InvestmentCategory;
  quantityMinor: number | null; navMinor: number | null; costMinor: number | null;
  valueMinor: number; currency: string; source: string; providerReportedAt: string;
  isStale: boolean; isSandbox: boolean;
}

export interface PortfolioAccountView {
  id: string; providerCode: string; name: string; accountType: string;
  maskedNumber: string | null; valueMinor: number; costMinor: number;
  lastSyncedAt: string | null; source: string; isSandbox: boolean;
}

export interface PortfolioView {
  investedMinor: number; currentValueMinor: number; absoluteReturnMinor: number;
  returnPctBps: number; allocation: Array<{ key: string; valueMinor: number; pctBps: number }>;
  accounts: PortfolioAccountView[]; holdings: PortfolioHoldingView[];
  providerCount: number; holdingsCount: number; lastUpdatedAt: string | null;
  isSandbox: boolean; hasHistory: boolean; notice: string;
}

export interface PortfolioPerformancePoint {
  capturedAt: string; investedMinor: number; currentValueMinor: number;
}

export interface InvestmentTransactionView {
  id: string; accountId: string; providerRef: string; type: string;
  amountMinor: number; quantityMinor: number | null; priceMinor: number | null;
  occurredAt: string; providerStatus: string | null; source: string; isSandbox: boolean;
}

export interface FundView {
  id: string; code: string; name: string; amc: string; category: InvestmentCategory;
  planType: string; optionType: string; navMinor: number | null; navDate: string | null;
  expenseRatioBps: number | null; riskometer: string | null; benchmark: string | null;
  minInvestmentMinor: number | null; minSipMinor: number | null;
  performance: Record<string, number>; source: string; retrievedAt: string; isSandbox: boolean;
}

export interface InstrumentView {
  id: string; symbol: string; name: string; exchange: string | null;
  category: InvestmentCategory; sector: string | null; priceMinor: number | null;
  changeMinor: number; changePct: number; feedType: string; source: string;
  retrievedAt: string; isSandbox: boolean;
}

export interface WatchlistView {
  id: string; name: string; isDefault: boolean; items: InstrumentView[];
}

export interface SipView {
  id: string; schemeCode: string; schemeName: string; amountMinor: number;
  frequency: string; nextInstalmentDate: string | null; instalmentsCompleted: number;
  investedMinor: number; currentValueMinor: number | null; status: SIPStatus;
  source: string; providerReportedAt: string; isSandbox: boolean;
}

export interface SipProjectionYear {
  year: number; investedMinor: number; estimatedValueMinor: number;
}

export interface SipProjection {
  monthlyMinor: number; months: number; assumedReturnBps: number;
  totalInvestedMinor: number; estimatedReturnsMinor: number;
  estimatedMaturityMinor: number; years: SipProjectionYear[];
  notice: string;
}

export interface InvestmentGoalView {
  id: string; name: string; goalType: string; targetAmountMinor: number;
  targetDate: string | null; currentAmountMinor: number; progressBps: number;
  monthlyTargetMinor: number | null; requiredMonthlyMinor: number | null;
  status: string; note: string | null;
}

export interface FixedIncomeView {
  id: string; name: string; category: string; principalMinor: number;
  interestRateBps: number | null; maturityDate: string | null;
  currentValueMinor: number | null; source: string; isSandbox: boolean;
  notice: string;
}

export interface NetWorthView {
  totalAssetsMinor: number; totalLiabilitiesMinor: number; netWorthMinor: number;
  walletMinor: number; bankMinor: number; investmentsMinor: number;
  fixedIncomeMinor: number; liabilitiesMinor: number;
  completeness: string; capturedAt: string | null; currency: string; notice: string;
}

export interface PortfolioInsightView {
  id: string; kind: string; title: string; explanation: string;
  evidence: Record<string, unknown>; dataAsOf: string;
}

export interface InvestmentOperationsView {
  providers: number; availableProviders: number; connections: number;
  activeConnections: number; syncJobsFailed: number; holdings: number;
  transactions: number; staleHoldings: number; lastSyncAt: string | null; currency: string;
}
