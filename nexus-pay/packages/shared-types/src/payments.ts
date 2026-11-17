export const PAYMENT_INTENT_STATUSES = [
  "CREATED",
  "PROCESSING",
  "SETTLED",
  "REJECTED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;

export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const FUNDING_STATUSES = [
  "CREATED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "UNKNOWN",
  "RECONCILIATION_REQUIRED",
] as const;

export type FundingStatus = (typeof FUNDING_STATUSES)[number];

export const TRANSACTION_STATUSES = [
  "PROCESSING",
  "SUCCESSFUL",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_KINDS = ["P2P", "FUNDING"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_DIRECTIONS = ["SENT", "RECEIVED"] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const HISTORY_FILTERS = [
  "ALL",
  "SENT",
  "RECEIVED",
  "SUCCESSFUL",
  "FAILED",
  "PROCESSING",
] as const;

export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const HISTORY_SORTS = ["newest", "oldest"] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const MIN_PAYMENT_MINOR = 100;
export const MAX_PAYMENT_MINOR = 10_000_000;
export const MIN_FUNDING_MINOR = 100;
export const MAX_FUNDING_MINOR = 10_000_000;
export const MAX_PAYMENT_DESCRIPTION_LENGTH = 140;
export const SIMULATED_FUNDING_DISCLOSURE = "SIMULATED SANDBOX FUNDING";

export const PAYMENT_STATUS_LABELS: Record<PaymentIntentStatus, string> = {
  CREATED: "Not sent",
  PROCESSING: "Processing",
  SETTLED: "Successful",
  REJECTED: "Failed",
  UNKNOWN: "Awaiting confirmation",
  RECONCILIATION_REQUIRED: "Verification required",
};

export const FUNDING_STATUS_LABELS: Record<FundingStatus, string> = {
  CREATED: "Not started",
  PROCESSING: "Processing",
  COMPLETED: "Successful",
  FAILED: "Failed",
  UNKNOWN: "Awaiting confirmation",
  RECONCILIATION_REQUIRED: "Verification required",
};

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  PROCESSING: "Processing",
  SUCCESSFUL: "Successful",
  FAILED: "Failed",
  RECONCILIATION_REQUIRED: "Verification required",
};

export const TRANSACTION_STATUS_TONE: Record<
  TransactionStatus,
  "info" | "success" | "danger" | "warning"
> = {
  PROCESSING: "info",
  SUCCESSFUL: "success",
  FAILED: "danger",
  RECONCILIATION_REQUIRED: "warning",
};

export interface RecipientSummary {
  displayName: string;
  username: string;
  /** Short-lived HMAC-signed handle used to authorise a payment recipient. */
  recipientToken: string;
}

export interface TransactionSummary {
  id: string;
  kind: TransactionKind;
  direction: TransactionDirection;
  status: TransactionStatus;
  amountMinor: number;
  currency: string;
  counterpartyName: string | null;
  counterpartyUsername: string | null;
  description: string | null;
  paymentRef: string | null;
  occurredAt: string;
  simulatedFunding: boolean;
}

export interface LedgerVerification {
  receiptVerified: boolean;
  verifiedAt: string | null;
  ledgerStatus: string | null;
  raftLogIndex: number | null;
  raftLogIndexAvailable: boolean;
  note: string;
}

export interface PaymentView {
  id: string;
  status: PaymentIntentStatus;
  transactionStatus: TransactionStatus;
  amountMinor: number;
  currency: string;
  recipient: {
    displayName: string;
    username: string;
  };
  sourceAccountMasked: string;
  description: string | null;
  paymentRef: string | null;
  rejectionCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  settledAt: string | null;
  idempotentReplay: boolean;
  verification: LedgerVerification;
  transaction: TransactionSummary | null;
}

export interface FundingView {
  id: string;
  status: FundingStatus;
  transactionStatus: TransactionStatus;
  amountMinor: number;
  currency: string;
  fundingRef: string | null;
  balanceAfterMinor: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  simulated: true;
  disclosure: typeof SIMULATED_FUNDING_DISCLOSURE;
  idempotentReplay: boolean;
  verification: LedgerVerification;
  transaction: TransactionSummary | null;
}

export interface TransactionParty {
  displayName: string;
  username: string | null;
  kind: "CUSTOMER" | "SIMULATED_RESERVE";
}

export interface TransactionParties {
  sender: TransactionParty;
  recipient: TransactionParty;
}

export interface TransactionDetail {
  transaction: TransactionSummary;
  /** Customer-facing reference. Never the internal database id when a ledger ref exists. */
  reference: string;
  rail: "INTERNAL_BOOK" | "SIMULATED_FUNDING";
  parties: TransactionParties;
  idempotentReplay: boolean;
  payment: PaymentView | null;
  funding: FundingView | null;
  timeline: Array<{
    label: string;
    at: string | null;
    complete: boolean;
  }>;
}

export interface TransactionListResult {
  items: TransactionSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filter: HistoryFilter;
  sort: HistorySort;
  search: string | null;
  from: string | null;
  to: string | null;
}

export interface ReceiveProfile {
  displayName: string;
  username: string;
  /** Shareable Nexus Pay handle, for example `@alice`. Never a UPI ID. */
  handle: string;
  paymentLink: string;
  currency: string;
  walletStatus: string;
  walletActive: boolean;
  disclosure: string;
}
