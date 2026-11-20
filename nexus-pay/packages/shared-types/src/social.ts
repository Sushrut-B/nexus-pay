/**
 * Release 3 social-payment contracts.
 *
 * Every monetary value is an integer number of minor units (paise). Balances,
 * splits and settlements are computed by the server; these types are only
 * transport shapes and must never be used as a source of truth in the browser.
 */

export const PAYMENT_REQUEST_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "PAID",
  "CANCELLED",
  "EXPIRED",
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_REQUEST_STATUS_LABELS: Record<PaymentRequestStatus, string> = {
  PENDING: "Awaiting response",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

export const GROUP_CATEGORIES = ["HOME", "TRAVEL", "FOOD", "FRIENDS", "FAMILY", "OTHER"] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];

export const GROUP_CATEGORY_LABELS: Record<GroupCategory, string> = {
  HOME: "Home",
  TRAVEL: "Travel",
  FOOD: "Food",
  FRIENDS: "Friends",
  FAMILY: "Family",
  OTHER: "Other",
};

export const EXPENSE_CATEGORIES = [
  "FOOD",
  "TRAVEL",
  "ACCOMMODATION",
  "SHOPPING",
  "TRANSPORT",
  "ENTERTAINMENT",
  "UTILITIES",
  "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  FOOD: "Food",
  TRAVEL: "Travel",
  ACCOMMODATION: "Accommodation",
  SHOPPING: "Shopping",
  TRANSPORT: "Transport",
  ENTERTAINMENT: "Entertainment",
  UTILITIES: "Utilities",
  OTHER: "Other",
};

export const SPLIT_METHODS = ["EQUAL", "CUSTOM", "PERCENTAGE", "SHARES"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export const SPLIT_METHOD_LABELS: Record<SplitMethod, string> = {
  EQUAL: "Split equally",
  CUSTOM: "Enter exact amounts",
  PERCENTAGE: "By percentage",
  SHARES: "By shares",
};

export const SETTLEMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SETTLED",
  "FAILED",
  "RECONCILIATION_REQUIRED",
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  PENDING: "Not started",
  PROCESSING: "Confirming",
  SETTLED: "Settled",
  FAILED: "Failed",
  RECONCILIATION_REQUIRED: "Verification required",
};

export const GROUP_ROLES = ["ADMIN", "MEMBER"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const NOTIFICATION_TYPES = [
  "PAYMENT_REQUEST_RECEIVED",
  "PAYMENT_REQUEST_ACCEPTED",
  "PAYMENT_REQUEST_DECLINED",
  "PAYMENT_REQUEST_PAID",
  "ADDED_TO_GROUP",
  "GROUP_EXPENSE_CREATED",
  "GROUP_EXPENSE_UPDATED",
  "SETTLEMENT_COMPLETED",
  "SETTLEMENT_FAILED",
  "BUDGET_THRESHOLD_REACHED",
  "BUDGET_EXCEEDED",
  "SCHEDULED_PAYMENT_DUE",
  "SCHEDULED_PAYMENT_COMPLETED",
  "SCHEDULED_PAYMENT_FAILED",
  "SCHEDULED_PAYMENT_ATTENTION",
  "SAVINGS_GOAL_COMPLETED",
  "STATEMENT_AVAILABLE",
  "MERCHANT_PAYMENT_RECEIVED",
  "MERCHANT_PAYMENT_FAILED",
  "MERCHANT_ORDER_CREATED",
  "MERCHANT_REFUND_REQUESTED",
  "MERCHANT_REFUND_OUTCOME",
  "SUBSCRIPTION_CREATED",
  "SUBSCRIPTION_TRIAL_ENDING",
  "SUBSCRIPTION_ACTIVATED",
  "SUBSCRIPTION_RENEWAL_SUCCEEDED",
  "SUBSCRIPTION_RENEWAL_FAILED",
  "SUBSCRIPTION_PAST_DUE",
  "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_PLAN_CHANGED",
  "SUBSCRIPTION_INVOICE_AVAILABLE",
  "REWARD_POINTS_EARNED",
  "REWARD_POINTS_REDEEMED",
  "REWARD_POINTS_EXPIRING",
  "REWARD_CASHBACK_PENDING",
  "REWARD_CASHBACK_CREDITED",
  "REWARD_CASHBACK_FAILED",
  "REWARD_CAMPAIGN_ACTIVATED",
  "REWARD_OFFER_AVAILABLE",
  "REWARD_TIER_UPGRADED",
  "REWARD_TIER_DOWNGRADED",
  "REWARD_REFERRAL_QUALIFIED",
  "REWARD_REFERRAL_ISSUED",
  "REWARD_PROMO_APPLIED",
  "REWARD_REDEMPTION_CONFIRMED",
  "FINANCE_INSIGHT_AVAILABLE",
  "FINANCE_ANOMALY_DETECTED",
  "FINANCE_FORECAST_READY",
  "FINANCE_BUDGET_RECOMMENDATION",
  "FINANCE_GOAL_REMINDER",
  "FINANCE_REPORT_READY",
  "FINANCE_RECURRING_DETECTED",
  "EXTERNAL_ACCOUNT_CONNECTED",
  "EXTERNAL_ACCOUNT_SYNC_FAILED",
  "EXTERNAL_ACCOUNT_CONSENT_EXPIRING",
  "EXTERNAL_ACCOUNT_DISCONNECTED",
  "INTERNAL_TRANSFER_SUGGESTED",
  "CREDIT_APPLICATION_STATUS_CHANGED",
  "CREDIT_ADDITIONAL_INFORMATION_REQUESTED",
  "CREDIT_OFFER_AVAILABLE",
  "CREDIT_REPAYMENT_REMINDER",
  "CREDIT_REPAYMENT_CONFIRMED",
  "CREDIT_LOAN_DISBURSED",
  "INSURANCE_QUOTE_RECEIVED",
  "INSURANCE_QUOTE_EXPIRING",
  "INSURANCE_APPLICATION_SUBMITTED",
  "INSURANCE_APPLICATION_STATUS_CHANGED",
  "INSURANCE_DOCUMENTS_REQUIRED",
  "INSURANCE_POLICY_ISSUED",
  "INSURANCE_POLICY_ACTIVATED",
  "INSURANCE_PREMIUM_DUE",
  "INSURANCE_RENEWAL_APPROACHING",
  "INSURANCE_POLICY_EXPIRED",
  "INSURANCE_CLAIM_SUBMITTED",
  "INSURANCE_CLAIM_STATUS_CHANGED",
  "INSURANCE_CLAIM_ADDITIONAL_INFO",
  "INSURANCE_CLAIM_COMPLETED",
  "SECURITY_NEW_DEVICE_LOGIN",
  "SECURITY_SUSPICIOUS_LOGIN",
  "SECURITY_RISK_ALERT",
  "SECURITY_SENSITIVE_ACTION_REQUIRED",
  "SECURITY_SESSION_REVOKED",
  "SECURITY_DEVICE_TRUST_CHANGED",
  "SECURITY_REPORT_STATUS_CHANGED",
  "SECURITY_CASE_UPDATE",
  "SECURITY_PAYMENT_WARNING",
  "BILL_FETCHED", "BILL_DUE_SOON", "BILL_OVERDUE", "BILL_PAYMENT_INITIATED",
  "BILL_PAYMENT_WALLET_SETTLED", "BILL_PAYMENT_CONFIRMED", "BILL_PAYMENT_FAILED",
  "BILL_PAYMENT_UNKNOWN", "BILL_REFUND_INITIATED", "BILL_REFUND_COMPLETED",
  "BILL_RECHARGE_SUCCESSFUL", "BILL_RECHARGE_FAILED", "BILL_RECURRING_DETECTED",
  "BILL_AUTO_PAYMENT_SCHEDULED", "BILL_AUTO_PAYMENT_CANCELLED",
  "TRAVEL_BOOKING_CONFIRMED", "TRAVEL_TICKET_ISSUED", "TRAVEL_BOOKING_FAILED",
  "TRAVEL_CANCELLATION_CONFIRMED", "TRAVEL_REFUND_STATUS", "TRAVEL_DEPARTURE_REMINDER",
  "TRAVEL_CHECKIN_REMINDER", "TRAVEL_TRIP_STARTING", "TRAVEL_DOCUMENT_REMINDER",
] as const;

export const CATEGORIZATION_SOURCES = ["SYSTEM_RULE", "USER_RULE", "MANUAL"] as const;
export type CategorizationSource = (typeof CATEGORIZATION_SOURCES)[number];
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ACTIVITY_EVENT_TYPES = [
  "GROUP_CREATED",
  "GROUP_UPDATED",
  "MEMBER_JOINED",
  "MEMBER_REMOVED",
  "EXPENSE_CREATED",
  "EXPENSE_UPDATED",
  "EXPENSE_DELETED",
  "SETTLEMENT_RECORDED",
  "SETTLEMENT_COMPLETED",
  "SETTLEMENT_FAILED",
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export interface SocialParty {
  userId: string;
  displayName: string;
  username: string;
}

export interface ContactView {
  id: string;
  user: SocialParty;
  displayLabel: string | null;
  createdAt: string;
  recentInteractionAt: string | null;
}

export interface ContactListResult {
  items: ContactView[];
  total: number;
}

export interface RequestView {
  id: string;
  requester: SocialParty;
  payer: SocialParty;
  amountMinor: number;
  currency: string;
  description: string | null;
  dueAt: string | null;
  status: PaymentRequestStatus;
  paymentRef: string | null;
  groupId: string | null;
  groupName: string | null;
  expenseId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  canAccept: boolean;
  canDecline: boolean;
  canCancel: boolean;
  canPay: boolean;
}

export interface RequestListResult {
  items: RequestView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RequestSummary {
  receivedPendingCount: number;
  sentPendingCount: number;
  receivedPendingMinor: number;
  sentPendingMinor: number;
}

export interface GroupMemberView extends SocialParty {
  membershipId: string;
  role: GroupRole;
  joinedAt: string;
  removedAt: string | null;
}

export interface GroupView {
  id: string;
  name: string;
  description: string | null;
  category: GroupCategory;
  imageUrl: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  memberCount: number;
  role: GroupRole;
  myBalanceMinor: number;
  lastActivityAt: string | null;
}

export interface GroupDetail extends GroupView {
  members: GroupMemberView[];
}

export interface GroupListResult {
  items: GroupView[];
  total: number;
}

export interface ExpenseSplitView {
  userId: string;
  displayName: string;
  username: string;
  shareAmountMinor: number;
  percentage: number | null;
  shares: number | null;
}

export interface ExpenseView {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  totalAmountMinor: number;
  currency: string;
  payer: SocialParty;
  splitMethod: SplitMethod;
  expenseDate: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  splits: ExpenseSplitView[];
}

export interface ExpenseListResult {
  items: ExpenseView[];
  total: number;
}

export interface BalanceEntry {
  user: SocialParty;
  /** Positive means the group owes this member; negative means they owe. */
  netMinor: number;
}

export interface GroupBalances {
  groupId: string;
  entries: BalanceEntry[];
  sumMinor: number;
  consistent: boolean;
  generatedAt: string;
}

export interface SuggestedSettlement {
  payer: SocialParty;
  payee: SocialParty;
  amountMinor: number;
}

export interface SettlementView {
  id: string;
  groupId: string;
  payer: SocialParty;
  payee: SocialParty;
  amountMinor: number;
  currency: string;
  status: SettlementStatus;
  paymentRef: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface SettlementListResult {
  items: SettlementView[];
  total: number;
}

export interface ActivityView {
  id: string;
  eventType: ActivityEventType;
  actor: SocialParty | null;
  entityType: string;
  entityId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface ActivityListResult {
  items: ActivityView[];
  total: number;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, string | number | boolean | null>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationView[];
  unreadCount: number;
  total: number;
}
