/**
 * Release 4 — personal finance intelligence contracts.
 *
 * All monetary values are integer minor units. These types describe derived
 * analytics and planning metadata; they are never a financial ledger.
 */

export const CATEGORY_TYPES = [
  "FOOD_DINING",
  "GROCERIES",
  "SHOPPING",
  "TRANSPORT",
  "TRAVEL",
  "ENTERTAINMENT",
  "RENT_HOUSING",
  "UTILITIES",
  "HEALTHCARE",
  "EDUCATION",
  "SUBSCRIPTIONS",
  "PERSONAL_TRANSFERS",
  "GROUP_EXPENSES",
  "INCOME",
  "OTHER",
  "UNCATEGORIZED",
] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const CATEGORY_TYPE_LABELS: Record<CategoryType, string> = {
  FOOD_DINING: "Food & Dining",
  GROCERIES: "Groceries",
  SHOPPING: "Shopping",
  TRANSPORT: "Transport",
  TRAVEL: "Travel",
  ENTERTAINMENT: "Entertainment",
  RENT_HOUSING: "Rent & Housing",
  UTILITIES: "Utilities",
  HEALTHCARE: "Healthcare",
  EDUCATION: "Education",
  SUBSCRIPTIONS: "Subscriptions",
  PERSONAL_TRANSFERS: "Personal Transfers",
  GROUP_EXPENSES: "Group Expenses",
  INCOME: "Income",
  OTHER: "Other",
  UNCATEGORIZED: "Uncategorized",
};

export const BUDGET_PERIOD_TYPES = ["WEEKLY", "MONTHLY", "CUSTOM"] as const;
export type BudgetPeriodType = (typeof BUDGET_PERIOD_TYPES)[number];

export const BUDGET_STATUS = ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
export type BudgetStatus = (typeof BUDGET_STATUS)[number];

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SAVINGS_GOAL_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "CANCELLED"] as const;
export type SavingsGoalStatus = (typeof SAVINGS_GOAL_STATUSES)[number];

export const SAVINGS_GOAL_STATUS_LABELS: Record<SavingsGoalStatus, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const CONTRIBUTION_TYPES = ["PLANNED", "RECORDED"] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export const SCHEDULE_FREQUENCIES = ["ONCE", "DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  ONCE: "Once",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
};

export const SCHEDULE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PAUSED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "REQUIRES_ATTENTION",
] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  PAUSED: "Paused",
  PROCESSING: "Processing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REQUIRES_ATTENTION: "Needs attention",
};

export const EXECUTION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "SETTLED",
  "FAILED",
  "RETRY_PENDING",
  "CANCELLED",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_STATUS_LABELS: Record<ExecutionStatus, string> = {
  PENDING: "Scheduled",
  PROCESSING: "Processing",
  SETTLED: "Completed",
  FAILED: "Failed",
  RETRY_PENDING: "Retry pending",
  CANCELLED: "Cancelled",
};

export const RECURRING_FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "UNKNOWN"] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];

export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
  UNKNOWN: "Irregular",
};

export const RULE_CONDITION_TYPES = ["CONTAINS", "STARTS_WITH", "ENDS_WITH", "EXACT"] as const;
export type RuleConditionType = (typeof RULE_CONDITION_TYPES)[number];

export const STATEMENT_FORMATS = ["PDF", "CSV"] as const;
export type StatementFormat = (typeof STATEMENT_FORMATS)[number];

export const INSIGHT_PERIODS = ["month", "last_month", "last_3_months", "last_6_months", "year", "custom"] as const;
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

export const BUDGET_THRESHOLDS = [50, 75, 90, 100] as const;

export interface CategoryView {
  id: string;
  name: string;
  categoryType: CategoryType;
  icon: string | null;
  isSystem: boolean;
  createdAt: string;
}

export interface CategorizationView {
  paymentRef: string;
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
  note: string | null;
  source: "SYSTEM_RULE" | "USER_RULE" | "MANUAL";
  updatedAt: string;
}

export interface CategoryRuleView {
  id: string;
  conditionType: RuleConditionType;
  conditionValue: string;
  categoryId: string;
  categoryName: string;
  priority: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetView {
  id: string;
  name: string;
  category: CategoryView;
  amountMinor: number;
  currency: string;
  periodType: BudgetPeriodType;
  startDate: string;
  endDate: string | null;
  status: BudgetStatus;
  spentMinor: number;
  remainingMinor: number;
  utilization: number;
  transactionCount: number;
  crossedThresholds: number[];
}

export interface BudgetListResult {
  items: BudgetView[];
  total: number;
}

export interface SavingsContributionView {
  id: string;
  amountMinor: number;
  contributionType: ContributionType;
  relatedPaymentRef: string | null;
  note: string | null;
  createdAt: string;
}

export interface SavingsGoalView {
  id: string;
  name: string;
  targetAmountMinor: number;
  currency: string;
  targetDate: string | null;
  description: string | null;
  icon: string | null;
  status: SavingsGoalStatus;
  recordedMinor: number;
  plannedMinor: number;
  remainingMinor: number;
  progress: number;
  contributions: SavingsContributionView[];
}

export interface SavingsGoalListResult {
  items: SavingsGoalView[];
  total: number;
}

export interface ScheduledPaymentView {
  id: string;
  recipient: {
    userId: string;
    displayName: string;
    username: string;
  };
  amountMinor: number;
  currency: string;
  description: string | null;
  frequency: ScheduleFrequency;
  startDate: string;
  endDate: string | null;
  nextExecutionAt: string;
  maxExecutions: number | null;
  executionCount: number;
  status: ScheduleStatus;
  lastExecution: ScheduledExecutionView | null;
  createdAt: string;
}

export interface ScheduledExecutionView {
  id: string;
  executionKey: string;
  paymentRef: string | null;
  scheduledFor: string;
  status: ExecutionStatus;
  attemptCount: number;
  lastErrorCode: string | null;
  executedAt: string | null;
  createdAt: string;
}

export interface RecurringSuggestionView {
  id: string;
  counterparty: string;
  counterpartyUsername: string | null;
  amountMinor: number;
  currency: string;
  suggestedFrequency: RecurringFrequency;
  lastObservedAt: string;
  nextExpectedAt: string | null;
  confidence: number;
  status: "SUGGESTED" | "CONFIRMED" | "IGNORED";
  explanation: string;
}

export interface CalendarEventView {
  id: string;
  type: "SCHEDULED_PAYMENT" | "BUDGET_PERIOD" | "SAVINGS_GOAL" | "RECURRING_ESTIMATE";
  title: string;
  date: string;
  amountMinor: number | null;
  status: string | null;
  reference: string | null;
}

export interface StatementCategorySummary {
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  transactionCount: number;
}

export interface StatementTotals {
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  transactionCount: number;
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  openingBalanceAvailable: boolean;
  closingBalanceAvailable: boolean;
  categories: StatementCategorySummary[];
}

export interface StatementView {
  id: string;
  periodStart: string;
  periodEnd: string;
  format: StatementFormat;
  status: "GENERATING" | "READY" | "FAILED";
  fileSize: number | null;
  createdAt: string;
  totals: StatementTotals;
}

export interface CashFlowPoint {
  label: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
}

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
  amountMinor: number;
  percentage: number;
  transactionCount: number;
  previousAmountMinor: number;
  changeMinor: number;
  changePercentage: number | null;
  trend: "up" | "down" | "flat" | "new";
}

export interface FinanceInsight {
  type: "info" | "positive" | "warning";
  message: string;
}

export interface FinanceOverview {
  period: {
    start: string;
    end: string;
    label: string;
  };
  receivedMinor: number;
  sentMinor: number;
  expenseMinor: number;
  netCashFlowMinor: number;
  walletBalanceMinor: number | null;
  savingsEstimateMinor: number | null;
  transactionCount: number;
  categoryBreakdown: CategoryBreakdown[];
  cashFlow: CashFlowPoint[];
  weekly: CashFlowPoint[];
  daily: CashFlowPoint[];
  insights: FinanceInsight[];
  generatedAt: string;
}
