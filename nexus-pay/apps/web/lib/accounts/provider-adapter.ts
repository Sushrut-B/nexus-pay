import type { ExternalAccountType, ExternalConnectionStatus } from "@nexus/database";

export interface ProviderCapabilities {
  balances: boolean;
  transactions: boolean;
  incrementalSync: boolean;
  refreshConsent: boolean;
  revokeConsent: boolean;
  hostedAuth: boolean;
}

export interface ProviderAccountData {
  providerAccountRef: string;
  accountType: ExternalAccountType;
  institutionName: string;
  maskedIdentifier: string;
  currency: string;
  /** Raw provider reference — stored encrypted, never returned to clients. */
  secretReference: string;
}

export interface ProviderBalanceData {
  providerAccountRef: string;
  reportedBalanceMinor: number;
  availableBalanceMinor?: number | null;
  currency: string;
  reportedAt: Date;
  liability: boolean;
  outstandingMinor?: number | null;
  availableCreditMinor?: number | null;
  statementMinor?: number | null;
  minimumDueMinor?: number | null;
  paymentDueDate?: Date | null;
  statementPeriodStart?: Date | null;
  statementPeriodEnd?: Date | null;
}

export interface ProviderTransactionData {
  providerTxRef: string;
  amountMinor: number;
  currency: string;
  direction: "IN" | "OUT";
  description: string;
  merchant?: string | null;
  category?: string | null;
  transactionAt: Date;
  postedAt?: Date | null;
  status: string;
  externalRef?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface ProviderContext {
  userId: string;
  providerConnectionRef: string;
  accountRefs: string[];
  consentRef: string | null;
  encryptedToken: string | null;
}

export interface InitiateInput {
  userId: string;
  state: string;
  purpose: string;
  dataCategories: string[];
}

export interface InitiateResult {
  authorizationUrl: string | null;
  providerConnectionRef: string;
  status: ExternalConnectionStatus;
  notice: string;
}

export interface CallbackResult {
  providerConnectionRef: string;
  accounts: ProviderAccountData[];
  encryptedToken: string | null;
}

export interface ProviderAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: ProviderCapabilities;
  initiateConnection(input: InitiateInput): Promise<InitiateResult>;
  verifyCallback(input: { state: string; code?: string; providerRef?: string }): boolean;
  handleCallback(input: { state: string; code?: string; providerRef?: string }): Promise<CallbackResult>;
  fetchAccounts(ctx: ProviderContext): Promise<ProviderAccountData[]>;
  fetchBalances(ctx: ProviderContext): Promise<ProviderBalanceData[]>;
  fetchTransactions(ctx: ProviderContext, cursor?: string | null): Promise<{
    transactions: ProviderTransactionData[];
    nextCursor: string | null;
  }>;
  refreshConsent(ctx: ProviderContext): Promise<void>;
  revokeConsent(ctx: ProviderContext): Promise<void>;
  getStatus(ctx: ProviderContext): Promise<string>;
}
