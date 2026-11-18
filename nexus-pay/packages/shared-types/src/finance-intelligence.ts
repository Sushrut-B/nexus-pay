/** Release 9 — Financial intelligence transport contracts. Values are derived read models. */

export const FINANCE_PERIODS = ["week", "month", "last_month", "quarter", "half_year", "year", "custom"] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

export interface FinanceOverviewExtended {
  period: { label: string; from: string; to: string; previousFrom: string; previousTo: string };
  walletBalanceMinor: number;
  inflowMinor: number;
  outflowMinor: number;
  netCashFlowMinor: number;
  savingsEstimateMinor: number;
  currentMonthSpendMinor: number;
  budgetUtilisationBps: number | null;
  upcomingScheduledMinor: number;
  upcomingSubscriptionMinor: number;
  cashbackCreditedMinor: number;
  goalProgressBps: number | null;
  previous: { inflowMinor: number; outflowMinor: number; netCashFlowMinor: number };
  completenessBps: number;
  currency: string;
  notice: string;
}

export interface FinanceCashFlowPoint {
  date: string;
  inflowMinor: number;
  outflowMinor: number;
  netMinor: number;
  transactionCount: number;
}

export interface CashFlowView {
  period: FinancePeriod;
  points: FinanceCashFlowPoint[];
  totalInflowMinor: number;
  totalOutflowMinor: number;
  netMinor: number;
  averageDailySpendMinor: number;
  averageWeeklySpendMinor: number;
  averageMonthlySpendMinor: number;
  highestSpendingDay: FinanceCashFlowPoint | null;
  lowestSpendingDay: FinanceCashFlowPoint | null;
  largestExpenseMinor: number;
  largestIncomeMinor: number;
  currency: string;
  definitions: Record<string, string>;
}

export interface CategorySpendView {
  category: string;
  amountMinor: number;
  transactionCount: number;
  changeBps: number | null;
}

export interface MerchantSpendView {
  merchant: string;
  amountMinor: number;
  transactionCount: number;
  changeBps: number | null;
}

export interface SpendingInsightView {
  id: string;
  title: string;
  body: string;
  kind: string;
  severity: string;
  status: string;
  createdAt: string;
}

export interface RecurringPatternView {
  id: string;
  merchant: string;
  amountMinor: number;
  frequency: string;
  confidence: string;
  status: string;
  lastSeenAt: string;
  nextExpectedAt: string | null;
  evidenceCount: number;
  currency: string;
}

export interface SubscriptionIntelligenceView {
  activeCount: number;
  pausedCount: number;
  failedCount: number;
  upcomingCount: number;
  monthlyCommitmentMinor: number;
  annualCommitmentMinor: number;
  upcoming: Array<{ id: string; planName: string; amountMinor: number; nextBillingDate: string | null; status: string }>;
  settledRenewalsMinor: number;
  currency: string;
  notice: string;
}

export interface GoalView {
  id: string;
  name: string;
  targetMinor: number;
  plannedMinor: number;
  recordedMinor: number;
  progressBps: number;
  targetDate: string | null;
  priority: string;
  status: string;
  estimatedCompletionDate: string | null;
  contributionCount: number;
  currency: string;
}

export interface ForecastView {
  id: string | null;
  kind: string;
  predictedMinor: number;
  lowMinor: number;
  highMinor: number;
  method: string;
  assumptions: string[];
  historyCount: number;
  periodStart: string;
  periodEnd: string;
  available: boolean;
  reason: string | null;
  currency: string;
}

export interface AnomalyView {
  id: string;
  category: string;
  severity: string;
  reason: string;
  baselineMinor: number;
  observedMinor: number;
  confidence: string;
  status: string;
  sourceRef: string;
  createdAt: string;
}

export interface HealthDimensionView {
  key: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface HealthScoreView {
  available: boolean;
  overallScore: number | null;
  dimensions: HealthDimensionView[];
  positiveFactors: string[];
  improvements: string[];
  computedAt: string | null;
  reason: string | null;
  formula: string;
  notice: string;
}

export interface BudgetRecommendationView {
  id: string;
  category: string;
  suggestedMinor: number;
  historicalAverageMinor: number;
  reason: string;
  confidence: string;
  status: string;
  createdAt: string;
}

export interface AssistantResult {
  conversationId: string;
  answer: string;
  dataSource: "ACTUAL" | "FORECAST" | "INSUFFICIENT";
  period: string | null;
  calculation: string | null;
  links: string[];
  references: string[];
  suggestedFollowUps: string[];
  mode: "DETERMINISTIC";
}

export interface AssistantConversationView {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ role: string; content: string; at: string }>;
}

export interface FinancialReportView {
  id: string;
  type: string;
  format: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  fileName: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface FinancialPreferenceView {
  defaultPeriod: string;
  timezone: string;
  insightNotifications: boolean;
  forecastNotifications: boolean;
  budgetRecommendationNotifications: boolean;
  recurringDetection: boolean;
  goalReminders: boolean;
}

export interface DataQualityView {
  completenessBps: number;
  classifiedRecords: number;
  totalRecords: number;
  issues: Array<{ code: string; severity: string; details: string; at: string }>;
  currency: string;
}

export interface FinanceOperationsView {
  snapshots: number;
  forecasts: number;
  anomalies: number;
  insights: number;
  failedReports: number;
  dataQualityIssues: number;
  processingBacklog: number;
  reconciliationFailures: number;
  lastWorkerRun: string | null;
  currency: string;
}
