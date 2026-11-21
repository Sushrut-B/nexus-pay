/** Release 19 — support case rules. Documentation only; no policy promises. */
import type {
  SupportCategory, SupportCaseStatus, SupportLinkType, SupportCategoryOption,
} from "@nexus/shared-types";

export const SUPPORT_NOTICE =
  "A support case is a case-management record. It does not change a payment, refund, cancellation or provider status. Support outcomes never claim money was moved unless the authoritative system confirms it.";

export const CATEGORY_OPTIONS: SupportCategoryOption[] = [
  { category: "PAYMENT_WRONG_RECIPIENT", label: "Payment sent to the wrong recipient", linkType: "P2P_PAYMENT", description: "A payment appears to have reached an unintended recipient." },
  { category: "PAYMENT_STATUS_UNCLEAR", label: "Payment pending or status unclear", linkType: "P2P_PAYMENT", description: "The payment status has not finished resolving." },
  { category: "PAYMENT_FAILED_BALANCE_AFFECTED", label: "Payment failed but balance appears affected", linkType: "WALLET_TRANSACTION", description: "A failed payment appears to have changed a wallet balance." },
  { category: "DUPLICATE_PAYMENT", label: "Duplicate payment concern", linkType: "P2P_PAYMENT", description: "You believe a payment was debited more than once." },
  { category: "REFUND_REVERSAL_DELAY", label: "Refund or reversal not received", linkType: "MERCHANT_ORDER", description: "An approved refund or reversal has not reached you." },
  { category: "MERCHANT_ORDER_ISSUE", label: "Merchant order issue", linkType: "MERCHANT_ORDER", description: "A merchant purchase, order or refund request needs review." },
  { category: "SUBSCRIPTION_BILLING_ISSUE", label: "Subscription billing issue", linkType: "SUBSCRIPTION_INVOICE", description: "A subscription renewal, invoice or cancellation needs review." },
  { category: "BILL_PAYMENT_ISSUE", label: "Bill payment issue", linkType: "BILL_PAYMENT", description: "A bill payment or recharge needs review." },
  { category: "TRAVEL_BOOKING_ISSUE", label: "Travel booking issue", linkType: "TRAVEL_BOOKING", description: "A trip, booking, cancellation or refund needs review." },
  { category: "INVESTMENT_CONNECTION_ISSUE", label: "Provider connection issue", linkType: "INVESTMENT_CONNECTION", description: "An investment or external account connection needs review." },
  { category: "TAX_DOCUMENT_ISSUE", label: "Tax document or report issue", linkType: "TAX_DOCUMENT", description: "A tax document, extraction or report needs review." },
  { category: "INTERNATIONAL_PAYMENT_ISSUE", label: "International payment issue", linkType: "INTERNATIONAL_TRANSFER", description: "An international transfer or compliance check needs review." },
  { category: "ACCOUNT_ACCESS_ISSUE", label: "Account access issue", linkType: "GENERAL", description: "You cannot sign in or access your account." },
  { category: "PROFILE_UPDATE_ISSUE", label: "Account or profile update issue", linkType: "GENERAL", description: "A profile, identity or preference update needs review." },
  { category: "DOCUMENT_STATEMENT_ISSUE", label: "Document or statement issue", linkType: "GENERAL", description: "A statement, receipt or document needs review." },
  { category: "UNAUTHORIZED_ACTIVITY", label: "Suspected unauthorized activity", linkType: "GENERAL", description: "You see activity you do not recognise." },
  { category: "OTHER", label: "Other", linkType: "GENERAL", description: "An issue that does not fit another category." },
];

export function categoryOption(category: SupportCategory): SupportCategoryOption {
  return CATEGORY_OPTIONS.find((option) => option.category === category) ?? CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
}

/** Customer-visible, non-technical status transitions. Staff-only steps are gated in the service. */
export const CASE_TRANSITIONS: Record<SupportCaseStatus, SupportCaseStatus[]> = {
  OPEN: ["TRIAGED", "WAITING_FOR_USER", "ESCALATED", "CLOSED"],
  TRIAGED: ["IN_PROGRESS", "WAITING_FOR_USER", "WAITING_FOR_PROVIDER", "ESCALATED"],
  IN_PROGRESS: ["WAITING_FOR_USER", "WAITING_FOR_PROVIDER", "ESCALATED", "RESOLUTION_PROPOSED", "RESOLVED"],
  WAITING_FOR_USER: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  WAITING_FOR_PROVIDER: ["IN_PROGRESS", "ESCALATED", "RESOLUTION_PROPOSED"],
  ESCALATED: ["IN_PROGRESS", "RESOLUTION_PROPOSED", "RESOLVED"],
  RESOLUTION_PROPOSED: ["RESOLVED", "REOPENED", "IN_PROGRESS"],
  RESOLVED: ["REOPENED", "CLOSED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["TRIAGED", "IN_PROGRESS", "ESCALATED"],
};

export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv", "text/plain",
]);

export const FORBIDDEN_FILE_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".ps1", ".js", ".ts", ".jar", ".msi", ".scr", ".vbs", ".dll",
]);

export function isSensitiveText(text: string): boolean {
  return /(password|\bpin\b|otp|one[- ]time|card number|cvv|secret|recovery phrase|mnemonic)/i.test(text);
}

/** Documented escalation signals. No automatic fraud or risk scoring is used. */
export const ESCALATION_SIGNALS = new Set([
  "UNAUTHORIZED_ACTIVITY", "MISSING_BALANCE", "REPEATED_PROVIDER_FAILURE",
  "VERIFIED_SERVICE_TARGET_EXCEEDED", "PROVIDER_INCIDENT", "ACCOUNT_INACCESSIBLE",
  "SPECIALIST_REVIEW",
]);

export function defaultNextAction(status: SupportCaseStatus): string | null {
  switch (status) {
    case "WAITING_FOR_USER": return "Provide the requested information or evidence.";
    case "RESOLUTION_PROPOSED": return "Review the proposed resolution.";
    case "WAITING_FOR_PROVIDER": return "No action needed while the provider response is pending.";
    default: return null;
  }
}

export function linkTypeForCategory(category: SupportCategory): SupportLinkType {
  return categoryOption(category).linkType;
}
