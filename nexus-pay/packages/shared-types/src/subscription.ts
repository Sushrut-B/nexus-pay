/** Release 7 — Subscriptions & recurring billing transport contracts. */

export const BILLING_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY", "CUSTOM"] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];

export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  "PENDING", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED", "CANCELLATION_SCHEDULED",
  "CANCELLED", "EXPIRED", "INCOMPLETE", "REQUIRES_CUSTOMER_ACTION",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ["DRAFT", "OPEN", "PROCESSING", "PAID", "PAST_DUE", "VOID", "UNCOLLECTIBLE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const OCCURRENCE_STATUSES = [
  "PENDING", "PROCESSING", "SETTLED", "FAILED", "UNRESOLVED", "RECONCILIATION_REQUIRED", "DEAD_LETTER", "SKIPPED",
] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export const CANCELLATION_TIMINGS = ["IMMEDIATE", "END_OF_PERIOD"] as const;
export type CancellationTiming = (typeof CANCELLATION_TIMINGS)[number];

export interface PricingSnapshot {
  amountMinor: number;
  setupFeeMinor: number;
  currency: string;
  frequency: BillingFrequency;
  intervalCount: number;
  trialDays: number;
  introPriceMinor: number | null;
  introPeriods: number;
  maxBillingPeriods: number | null;
  /** Plan version label so historical invoices can explain their price. */
  planName: string;
}

export interface PlanView {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  amountMinor: number;
  setupFeeMinor: number;
  currency: string;
  frequency: BillingFrequency;
  intervalCount: number;
  trialDays: number;
  introPriceMinor: number | null;
  introPeriods: number;
  maxBillingPeriods: number | null;
  cancellationPolicy: string | null;
  visibility: "PUBLIC" | "PRIVATE";
  status: PlanStatus;
  checkoutToken: string;
  createdAt: string;
}

export interface SubscriptionView {
  id: string;
  merchantId: string;
  customerUserId: string;
  planId: string;
  planName: string;
  pricingSnapshot: PricingSnapshot;
  status: SubscriptionStatus;
  timezone: string;
  startDate: string;
  trialEndDate: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  nextBillingDate: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  occurrenceCount: number;
  createdAt: string;
}

export interface SubscriptionEventView {
  id: string;
  event: string;
  actor: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface InvoiceView {
  id: string;
  merchantId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  setupFeeMinor: number;
  totalMinor: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  paymentRef: string | null;
  customerName: string;
  customerEmail: string;
  items: Array<{ description: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  createdAt: string;
}

export interface BillingOccurrenceView {
  id: string;
  subscriptionId: string;
  occurrenceNumber: number;
  periodStart: string;
  periodEnd: string;
  amountMinor: number;
  status: OccurrenceStatus;
  attemptCount: number;
  failureCategory: string | null;
  paymentRef: string | null;
  invoiceNumber: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SubscriptionCheckoutView {
  merchant: { id: string; displayName: string; handle: string; logoUrl: string | null; brandColor: string | null };
  plan: PlanView;
  amountDueTodayMinor: number;
  firstBillingDate: string;
  subsequentBilling: string;
  trialEndDate: string | null;
  cancellationPolicy: string | null;
  signedIn: boolean;
  sandboxNotice: string;
}

export interface SubscriptionAnalytics {
  range: { from: string; to: string };
  mrrMinor: number;
  arrMinor: number;
  activeSubscriptions: number;
  newSubscriptions: number;
  cancelledSubscriptions: number;
  churnRate: number | null;
  averageSubscriptionValueMinor: number;
  trialConversionRate: number | null;
  failedRenewalRate: number | null;
  recoveryRate: number | null;
  outstandingInvoiceMinor: number;
  collectedRenewalMinor: number;
  currency: string;
  definitions: Record<string, string>;
}
