/** Release 14 — Bill payments & recharges transport contracts. */

export const BILL_CATEGORIES = [
  "ELECTRICITY", "WATER", "GAS", "LPG", "BROADBAND", "LANDLINE",
  "MOBILE_POSTPAID", "MOBILE_PREPAID", "DTH", "FASTAG", "MUNICIPAL_TAX",
  "SOCIETY_MAINTENANCE", "EDUCATION_FEES", "OTHER",
] as const;
export type BillCategory = (typeof BILL_CATEGORIES)[number];

export const BILL_PAYMENT_STATUSES = [
  "CREATED", "CUSTOMER_CONFIRMATION_REQUIRED", "PAYMENT_AUTHORIZED",
  "WALLET_SETTLEMENT_PENDING", "WALLET_SETTLED", "PROVIDER_SUBMISSION_PENDING",
  "PROVIDER_PROCESSING", "BILLER_CONFIRMED", "FAILED", "UNKNOWN",
  "RECONCILIATION_REQUIRED", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REVERSED",
] as const;
export type BillPaymentStatus = (typeof BILL_PAYMENT_STATUSES)[number];

export const RECHARGE_STATUSES = [
  "CREATED", "VALIDATION_PENDING", "VALIDATED", "PAYMENT_PENDING", "PROCESSING",
  "SUCCESS", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED", "REFUND_PENDING", "REFUNDED",
] as const;
export type RechargeStatus = (typeof RECHARGE_STATUSES)[number];

export interface BillerView {
  id: string; name: string; category: BillCategory; billerType: "POSTPAID" | "PREPAID";
  providerName: string; coverage: string | null; canFetchBill: boolean;
  canPayBill: boolean; supportsRecharge: boolean; parameters: Array<{ name: string; label: string; required: boolean; sensitive: boolean }>;
  source: string; lastSyncAt: string;
}

export interface SavedBillAccountView {
  id: string; billerId: string; billerName: string; category: BillCategory;
  nickname: string; maskedIdentifier: string; lastFetchAt: string | null;
  lastPaymentAt: string | null; status: string;
}

export interface BillSnapshotView {
  id: string; fetchRequestId: string; billNumber: string | null; billPeriod: string | null;
  billDate: string | null; dueDate: string | null; amountMinor: number;
  minAmountMinor: number | null; lateFeeMinor: number | null; extraChargesMinor: number | null;
  status: string; fetchedAt: string; expiresAt: string | null; isSandbox: boolean;
}

export interface BillPaymentView {
  id: string; reference: string; billerName: string; category: BillCategory;
  maskedAccount: string; amountMinor: number; feeMinor: number; totalMinor: number;
  status: BillPaymentStatus; paymentRef: string | null; providerRef: string | null;
  confirmedAt: string | null; createdAt: string; isSandbox: boolean;
  notice: string;
}

export interface RechargeView {
  id: string; reference: string; billerName: string; amountMinor: number;
  status: RechargeStatus; paymentRef: string | null; providerRef: string | null;
  createdAt: string; isSandbox: boolean; notice: string;
}

export interface RechargePlanView {
  id: string; billerId: string; code: string; name: string; priceMinor: number;
  validity: string | null; dataAllowance: string | null; benefits: string[];
  terms: string | null; retrievedAt: string;
}

export interface BillReceiptView {
  id: string; reference: string; kind: string; amountMinor: number; status: string;
  officialProviderReceipt: boolean; createdAt: string;
}

export interface BillReminderView {
  id: string; billerId: string; kind: string; dueAt: string; status: string; sentAt: string | null;
}

export interface RecurringBillView {
  id: string; billerId: string; pattern: string; expectedMinMinor: number | null;
  expectedMaxMinor: number | null; lastPaymentDate: string | null;
  nextExpectedDate: string | null; confirmedByUser: boolean; status: string;
}

export interface BillOverviewView {
  savedBillers: number; upcomingDue: number; overdue: number; recentPayments: number;
  monthlySpendMinor: number; rechargeSpendMinor: number; providersAvailable: number;
  currency: string; notice: string;
}

export interface BillOperationsView {
  providers: number; availableProviders: number; billers: number; payments: number;
  confirmedPayments: number; recharges: number; unknownOutcomes: number;
  reconciliationCases: number; lastSyncAt: string | null; currency: string;
}
