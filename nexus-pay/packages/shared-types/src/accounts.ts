/** Release 10 — Unified financial hub transport contracts. */

export const EXTERNAL_ACCOUNT_TYPES = [
  "NEXUS_WALLET", "SAVINGS", "CURRENT", "FIXED_DEPOSIT", "RECURRING_DEPOSIT",
  "CREDIT_CARD", "LOAN", "OTHER",
] as const;
export type ExternalAccountType = (typeof EXTERNAL_ACCOUNT_TYPES)[number];

export const CONNECTION_STATUSES = [
  "NOT_CONNECTED", "INITIATING", "AWAITING_USER_AUTHORIZATION", "AUTHORIZED",
  "SYNC_PENDING", "ACTIVE", "PARTIALLY_CONNECTED", "EXPIRED", "REVOKED",
  "FAILED", "REQUIRES_ATTENTION",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export interface ProviderView {
  id: string;
  code: string;
  displayName: string;
  mode: "SANDBOX" | "PRODUCTION";
  capabilities: Record<string, boolean>;
  status: string;
  available: boolean;
  notice: string;
}

export interface ConnectionInitiation {
  connectionId: string;
  providerCode: string;
  authorizationUrl: string | null;
  state: string;
  status: ConnectionStatus;
  expiresAt: string;
  notice: string;
}

export interface ConnectionView {
  id: string;
  providerId: string;
  providerName: string;
  status: ConnectionStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  accountCount: number;
  activeConsentId: string | null;
  createdAt: string;
}

export interface ExternalAccountView {
  id: string;
  connectionId: string;
  providerName: string;
  accountType: ExternalAccountType;
  institutionName: string;
  maskedIdentifier: string;
  currency: string;
  status: string;
  balanceMinor: number | null;
  availableMinor: number | null;
  liability: boolean;
  lastSyncAt: string | null;
  consentStatus: string | null;
  creditDetails: {
    outstandingMinor: number | null;
    availableCreditMinor: number | null;
    statementMinor: number | null;
    minimumDueMinor: number | null;
    paymentDueDate: string | null;
  } | null;
  isWallet: boolean;
  isSandbox: boolean;
}

export interface ConsentView {
  id: string;
  connectionId: string;
  providerName: string;
  status: string;
  purpose: string;
  dataCategories: string[];
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  events: Array<{ event: string; actor: string; at: string }>;
}

export interface UnifiedTransactionView {
  id: string;
  source: "NEXUS_WALLET" | "EXTERNAL";
  accountId: string;
  institution: string;
  maskedAccount: string;
  description: string;
  merchant: string | null;
  amountMinor: number;
  currency: string;
  direction: "IN" | "OUT";
  transactionAt: string;
  postedAt: string | null;
  status: string;
  category: string;
  externalRef: string | null;
  isSandbox: boolean;
}

export interface TransferMatchView {
  id: string;
  debitAccount: string;
  creditAccount: string;
  amountMinor: number;
  currency: string;
  confidence: string;
  status: string;
  reason: string;
  createdAt: string;
}

export interface AccountAnalyticsView {
  scope: string;
  cashBalanceMinor: number;
  liabilityMinor: number;
  netPositionMinor: number;
  inflowMinor: number;
  outflowMinor: number;
  excludedInternalTransfersMinor: number;
  transactionCount: number;
  accountBreakdown: Array<{ accountId: string; label: string; balanceMinor: number; liability: boolean; transactionCount: number }>;
  currency: string;
  notice: string;
}

export interface PrivacyDataView {
  providers: Array<{ name: string; mode: string; connectedAt: string }>;
  activeConsents: number;
  revokedConsents: number;
  lastRetrievalAt: string | null;
  dataCategories: string[];
  retentionNotice: string;
  accesses: Array<{ action: string; target: string; at: string }>;
  deletionRequests: Array<{ id: string; status: string; createdAt: string }>;
}

export interface ControlAccountsView {
  providers: number;
  connections: number;
  activeConsents: number;
  expiredConsents: number;
  revokedConsents: number;
  failedJobs: number;
  providerLatencyMs: number | null;
  importBacklog: number;
  duplicateEvents: number;
  callbackFailures: number;
  reconciliationFailures: number;
  lastHealthCheck: string | null;
  currency: string;
}
