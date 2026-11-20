/** Release 13 — Fraud intelligence & security transport contracts. */

export const SECURITY_EVENT_TYPES = [
  "LOGIN_SUCCESS", "LOGIN_FAILURE", "LOGOUT", "PASSWORD_CHANGED",
  "PASSWORD_RESET_REQUESTED", "PASSWORD_RESET_COMPLETED", "NEW_DEVICE_LOGIN",
  "SESSION_CREATED", "SESSION_REVOKED", "MFA_ENABLED", "MFA_FAILED",
  "SENSITIVE_ACTION_VERIFIED", "SENSITIVE_ACTION_VERIFICATION_FAILED",
  "PROFILE_CHANGED", "EMAIL_CHANGED", "PHONE_CHANGED", "RECOVERY_DETAILS_CHANGED",
  "WALLET_CREATED", "ACCOUNT_RECOVERY_REQUESTED", "PAYMENT_INITIATED",
  "PAYMENT_REVIEWED", "PAYMENT_PROCESSING", "PAYMENT_SETTLED", "PAYMENT_REJECTED",
  "PAYMENT_UNKNOWN", "PAYMENT_RECONCILIATION_REQUIRED", "PAYMENT_CANCELLED",
  "MERCHANT_REGISTERED", "MERCHANT_SETTINGS_CHANGED", "PAYMENT_LINK_CREATED",
  "CHECKOUT_PAYMENT_INITIATED", "REFUND_REQUESTED", "WEBHOOK_CONFIGURATION_CHANGED",
  "REWARD_EARNED", "REWARD_REDEEMED", "REFERRAL_CREATED", "REFERRAL_REWARDED",
  "CASHBACK_ISSUED", "LOAN_APPLICATION_SUBMITTED", "INSURANCE_QUOTE_REQUESTED",
  "INSURANCE_APPLICATION_SUBMITTED", "DOCUMENT_UPLOADED", "PROVIDER_WEBHOOK_RECEIVED",
  "BILLER_ACCOUNT_ADDED", "BILL_FETCH_REQUESTED", "BILL_PAYMENT_INITIATED",
  "BILL_PAYMENT_CONFIRMED", "BILL_PAYMENT_FAILED", "RECHARGE_INITIATED",
  "RECHARGE_CONFIRMED", "RECHARGE_FAILED", "REPEATED_PAYMENT_ATTEMPT",
  "BILLER_DETAILS_CHANGED", "AUTOMATIC_PAYMENT_AUTHORIZED", "AUTOMATIC_PAYMENT_CANCELLED",
  "TRAVEL_SEARCH_CREATED", "TRAVEL_BOOKING_INITIATED", "TRAVEL_BOOKING_CONFIRMED",
  "TRAVEL_CANCELLATION_REQUESTED", "TRAVEL_REFUND_REQUESTED",
  "TRAVEL_PASSENGER_DETAILS_CHANGED", "UNUSUAL_BOOKING_ATTEMPT",
  "INVESTMENT_CONNECTION_INITIATED", "INVESTMENT_CONNECTED", "INVESTMENT_DISCONNECTED",
  "INVESTMENT_SYNC_COMPLETED", "INVESTMENT_HOLDINGS_CHANGED", "INVESTMENT_GOAL_CREATED",
  "INVESTMENT_WATCHLIST_CHANGED", "UNUSUAL_INVESTMENT_ACTIVITY",
  "TAX_CALCULATION_READY", "TAX_DOCUMENT_PROCESSED", "TAX_DEADLINE_REMINDER",
  "TAX_RECONCILIATION_REQUIRED",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export const RISK_CLASSIFICATIONS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type RiskClassification = (typeof RISK_CLASSIFICATIONS)[number];

export const RISK_ACTIONS = [
  "ALLOW", "ALLOW_WITH_MONITORING", "REQUIRE_STEP_UP_AUTHENTICATION",
  "REQUIRE_CUSTOMER_CONFIRMATION", "HOLD_FOR_MANUAL_REVIEW", "BLOCK_INITIATION",
] as const;
export type RiskAction = (typeof RISK_ACTIONS)[number];

export const FRAUD_CASE_STATUSES = [
  "OPEN", "TRIAGED", "INVESTIGATING", "CUSTOMER_CONTACT_REQUIRED",
  "PROVIDER_CONTACT_REQUIRED", "ESCALATED", "RESOLVED", "FALSE_POSITIVE", "CLOSED",
] as const;
export type FraudCaseStatus = (typeof FRAUD_CASE_STATUSES)[number];

export const FRAUD_REPORT_STATUSES = [
  "SUBMITTED", "ACKNOWLEDGED", "UNDER_REVIEW", "ADDITIONAL_INFORMATION_REQUIRED",
  "ESCALATED", "RESOLVED", "CLOSED",
] as const;
export type FraudReportStatus = (typeof FRAUD_REPORT_STATUSES)[number];

export interface SecurityEventView {
  id: string; eventId: string; type: SecurityEventType; version: number;
  occurredAt: string; recordedAt: string; actorId: string | null;
  subjectId: string | null; sourceModule: string; correlationId: string | null;
  deviceId: string | null; transactionRef: string | null;
  metadata: Record<string, unknown>; masked: boolean;
}

export interface RiskSignalView {
  name: string; value: string | null; weight: number; source: string; evidence: string | null;
}

export interface RiskEvaluationView {
  id: string; reference: string; mode: string; subjectType: string; subjectId: string;
  score: number; classification: RiskClassification; action: RiskAction;
  triggeredRules: Array<{ code: string; name: string; contribution: number }>;
  signals: RiskSignalView[]; explanation: string | null; evidenceQuality: string;
  rulesetVersion: string; policyVersion: string; modelVersion: string | null;
  createdAt: string;
}

export interface RiskAlertView {
  id: string; reference: string; score: number; severity: string; status: string;
  title: string; summary: string; triggeredRules: string[]; createdAt: string;
}

export interface FraudCaseView {
  id: string; caseNumber: string; userId: string | null; transactionRef: string | null;
  riskScore: number; status: FraudCaseStatus; priority: string; assignedTo: string | null;
  resolution: string | null; openedAt: string; resolvedAt: string | null;
}

export interface FraudReportView {
  id: string; reference: string; transactionRef: string | null; category: string;
  description: string; status: FraudReportStatus; resolution: string | null;
  createdAt: string; updatedAt: string; documentCount: number;
}

export interface DeviceView {
  id: string; deviceId: string; description: string; firstSeen: string;
  lastSeen: string; trusted: boolean; revokedAt: string | null; current: boolean;
}

export interface SessionView {
  id: string; sessionId: string; deviceId: string | null; score: number;
  classification: string; lastEvaluatedAt: string; current: boolean;
}

export interface SecurityOverviewView {
  events24h: number; evaluations24h: number; highRiskAlerts: number;
  openCases: number; authFailures24h: number; suspiciousPayments24h: number;
  confirmedFraud: number; rulesEnabled: number; fallbackAction: string;
  notice: string; currency: string;
}

export interface FraudOperationsView extends SecurityOverviewView {
  riskByClassification: Record<string, number>;
  alertsByStatus: Record<string, number>;
  casesByStatus: Record<string, number>;
  ruleTriggers: Array<{ code: string; count: number }>;
  activeModelVersion: string | null;
  eventBacklog: number;
}

export interface SafetyGuideView {
  id: string; title: string; summary: string; bullets: string[];
}

export interface SecurityWarningView {
  id: string; kind: string; title: string; message: string; severity: string;
  acknowledged: boolean; createdAt: string;
}
