/**
 * Release 19 — Customer Support & Resolution Centre transport contracts.
 *
 * A support case is a case-management record. It never overrides an
 * authoritative payment, refund, cancellation or provider status. Linked
 * operations are read-only references resolved and ownership-checked server-side.
 */

export const SUPPORT_CASE_STATUSES = [
  "OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_PROVIDER",
  "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED", "CLOSED", "REOPENED",
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_MESSAGE_VISIBILITY = ["CUSTOMER_VISIBLE", "INTERNAL_ONLY"] as const;
export type SupportMessageVisibility = (typeof SUPPORT_MESSAGE_VISIBILITY)[number];

/** Only categories for modules that actually exist in Releases 1-18. */
export const SUPPORT_CATEGORIES = [
  "PAYMENT_WRONG_RECIPIENT",
  "PAYMENT_STATUS_UNCLEAR",
  "PAYMENT_FAILED_BALANCE_AFFECTED",
  "DUPLICATE_PAYMENT",
  "REFUND_REVERSAL_DELAY",
  "MERCHANT_ORDER_ISSUE",
  "SUBSCRIPTION_BILLING_ISSUE",
  "BILL_PAYMENT_ISSUE",
  "TRAVEL_BOOKING_ISSUE",
  "INVESTMENT_CONNECTION_ISSUE",
  "TAX_DOCUMENT_ISSUE",
  "INTERNATIONAL_PAYMENT_ISSUE",
  "ACCOUNT_ACCESS_ISSUE",
  "PROFILE_UPDATE_ISSUE",
  "DOCUMENT_STATEMENT_ISSUE",
  "UNAUTHORIZED_ACTIVITY",
  "OTHER",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_LINK_TYPES = [
  "WALLET_TRANSACTION", "P2P_PAYMENT", "MERCHANT_ORDER", "SUBSCRIPTION_INVOICE",
  "BILL_PAYMENT", "TRAVEL_BOOKING", "INVESTMENT_CONNECTION", "TAX_DOCUMENT",
  "INTERNATIONAL_TRANSFER", "GENERAL",
] as const;
export type SupportLinkType = (typeof SUPPORT_LINK_TYPES)[number];

export interface SupportCaseView {
  id: string;
  reference: string;
  category: SupportCategory;
  status: SupportCaseStatus;
  priority: SupportPriority;
  description: string;
  linkType: SupportLinkType;
  linkedReference: string | null;
  linkedSummary: string | null;
  authoritativeStatus: string | null;
  assignedTo: string | null;
  unreadCount: number;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  notice: string;
}

export interface SupportCaseEventView {
  id: string;
  kind: string;
  detail: string;
  createdAt: string;
  actorLabel: string;
}

export interface SupportMessageView {
  id: string;
  senderLabel: string;
  senderRole: string;
  body: string;
  visibility: SupportMessageVisibility;
  createdAt: string;
  attachments: SupportAttachmentView[];
}

export interface SupportAttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface SupportCaseDetailView extends SupportCaseView {
  events: SupportCaseEventView[];
  messages: SupportMessageView[];
  resolutionSummary: string | null;
}

export interface HelpArticleView {
  id: string;
  slug: string;
  categoryCode: string;
  title: string;
  body: string;
  version: number;
  lastReviewedAt: string;
  related: Array<{ id: string; title: string }>;
  helpful: boolean | null;
  status: string;
}

export interface SupportCategoryOption {
  category: SupportCategory;
  label: string;
  linkType: SupportLinkType;
  description: string;
}

export interface SupportOperationsView {
  cases: SupportCaseView[];
  total: number;
  open: number;
  awaitingUser: number;
  awaitingProvider: number;
  escalated: number;
  resolutionProposed: number;
  resolved: number;
  reopenRateBps: number;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  byCategory: Record<string, number>;
  byModule: Record<string, number>;
  byStatus: Record<string, number>;
  backlogAging: Record<string, number>;
  audit: Array<{ id: string; action: string; actorId: string; createdAt: string }>;
  notice: string;
}
