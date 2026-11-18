/** Release 6 — Merchant ecosystem transport contracts. */

export const MERCHANT_TYPES = [
  "INDIVIDUAL_BUSINESS",
  "SOLE_PROPRIETORSHIP",
  "SMALL_BUSINESS",
  "COMPANY",
  "ENTERPRISE",
] as const;
export type MerchantType = (typeof MERCHANT_TYPES)[number];

export const MERCHANT_TYPE_LABELS: Record<MerchantType, string> = {
  INDIVIDUAL_BUSINESS: "Individual business",
  SOLE_PROPRIETORSHIP: "Sole proprietorship",
  SMALL_BUSINESS: "Small business",
  COMPANY: "Company",
  ENTERPRISE: "Enterprise",
};

export const MERCHANT_STATUSES = ["DRAFT", "PENDING_REVIEW", "ACTIVE", "SUSPENDED", "CLOSED"] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export const MERCHANT_STATUS_LABELS: Record<MerchantStatus, string> = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

export const MERCHANT_ORDER_STATUSES = [
  "DRAFT", "CREATED", "PAYMENT_PENDING", "PARTIALLY_PAID", "PAID",
  "EXPIRED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED",
] as const;
export type MerchantOrderStatus = (typeof MERCHANT_ORDER_STATUSES)[number];

export const PAYMENT_LINK_STATUSES = ["DRAFT", "ACTIVE", "PAID", "EXPIRED", "CANCELLED", "DISABLED"] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export const REFUND_STATUSES = [
  "REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING", "SUCCEEDED", "FAILED", "REJECTED", "UNKNOWN",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const WEBHOOK_EVENT_TYPES = [
  "payment.created", "payment.processing", "payment.succeeded", "payment.failed",
  "order.created", "order.paid", "payment_link.created", "payment_link.paid",
  "refund.requested", "refund.succeeded", "refund.failed",
  "subscription.created", "subscription.trial_started", "subscription.activated",
  "subscription.past_due", "subscription.paused", "subscription.resumed",
  "subscription.plan_changed", "subscription.cancellation_scheduled", "subscription.cancelled", "subscription.trial_ended",
  "invoice.created", "invoice.paid", "invoice.past_due",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const API_SCOPES = [
  "payments:read", "payments:create", "orders:read", "orders:create",
  "payment_links:read", "payment_links:create", "refunds:read", "refunds:create",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface MerchantView {
  id: string;
  handle: string;
  businessName: string;
  displayName: string;
  businessType: MerchantType;
  category: string;
  description: string | null;
  email: string;
  phone: string;
  website: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  status: MerchantStatus;
  currency: string;
  createdAt: string;
}

export interface MerchantOrderView {
  id: string;
  merchantId: string;
  title: string;
  description: string | null;
  customerName: string | null;
  customerEmail: string | null;
  items: Array<{ id: string; title: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  currency: string;
  status: MerchantOrderStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface PaymentLinkView {
  id: string;
  token: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  maxPayments: number | null;
  paymentCount: number;
  totalCollectedMinor: number;
  status: PaymentLinkStatus;
  expiresAt: string | null;
  url: string;
  createdAt: string;
}

export interface MerchantPaymentView {
  id: string;
  orderId: string | null;
  customerUserId: string;
  paymentRef: string;
  amountMinor: number;
  currency: string;
  status: string;
  source: string;
  refundedMinor: number;
  createdAt: string;
}

export interface RefundView {
  id: string;
  paymentId: string;
  orderId: string | null;
  amountMinor: number;
  reason: string;
  type: string;
  status: RefundStatus;
  reviewNote: string | null;
  executionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface MerchantCustomerView {
  id: string;
  displayName: string;
  emailMasked: string | null;
  phoneMasked: string | null;
  totalPaidMinor: number;
  orderCount: number;
  lastPurchaseAt: string | null;
}

export interface MerchantAnalytics {
  range: { from: string; to: string };
  grossVolumeMinor: number;
  netVolumeMinor: number;
  successfulPayments: number;
  failedPayments: number;
  refundedMinor: number;
  averageOrderValueMinor: number;
  uniqueCustomers: number;
  repeatCustomerRate: number | null;
  byDay: Array<{ date: string; amountMinor: number; count: number; refundedMinor: number }>;
  currency: string;
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
}

export interface WebhookDeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  attempt: number;
  status: string;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
