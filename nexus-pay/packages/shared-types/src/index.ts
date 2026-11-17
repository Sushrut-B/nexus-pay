export const ERROR_CATEGORIES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_ERROR",
  "AUTHORIZATION_ERROR",
  "DATABASE_ERROR",
  "RAFTLINE_UNAVAILABLE",
  "RAFTLINE_TIMEOUT",
  "WALLET_PROVISIONING_ERROR",
  "INTERNAL_SERVER_ERROR",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export interface ApiErrorBody {
  error: {
    category: ErrorCategory;
    message: string;
    fields?: Record<string, string>;
  };
  requestId: string;
}

export const WALLET_STATUSES = [
  "PENDING",
  "PROVISIONING",
  "ACTIVE",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;

export type WalletStatus = (typeof WALLET_STATUSES)[number];

export type WalletStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const WALLET_STATUS_TONE: Record<WalletStatus, WalletStatusTone> = {
  PENDING: "neutral",
  PROVISIONING: "info",
  ACTIVE: "success",
  FAILED: "danger",
  RECONCILIATION_REQUIRED: "warning",
};

export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<CurrencyCode, string> = {
  INR: "Indian Rupee",
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  AED: "UAE Dirham",
  SGD: "Singapore Dollar",
};

export const SUPPORTED_LANGUAGES = ["en-IN", "hi-IN", "en-US"] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export interface WalletSummary {
  id: string;
  status: WalletStatus;
  currency: CurrencyCode;
  raftlineAccountId: string | null;
  provisionedAt: string | null;
  lastProvisioningError: string | null;
}

export interface BalanceSummary {
  amountMinor: number;
  currency: CurrencyCode;
}

export interface WalletOverview {
  wallet: WalletSummary;
  balance: BalanceSummary | null;
  balanceUnavailableReason:
    | "WALLET_NOT_ACTIVE"
    | "RAFTLINE_UNAVAILABLE"
    | "RAFTLINE_TIMEOUT"
    | "ACCOUNT_NOT_FOUND"
    | null;
}

export interface SessionUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  displayName: string;
  preferredCurrency: CurrencyCode;
  preferredLanguage: LanguageCode;
  onboardingCompletedAt: string | null;
  accountStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
}

export interface ApiSuccessBody<T> {
  data: T;
  requestId: string;
}
