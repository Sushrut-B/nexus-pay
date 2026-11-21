/** Release 20 — Account Security, Privacy & Identity Protection contracts. */

export const AUTH_METHOD_TYPES = ["PASSWORD", "TOTP", "RECOVERY_CODE", "PASSKEY"] as const;
export type AuthMethodType = (typeof AUTH_METHOD_TYPES)[number];

export const AUTH_METHOD_STATUSES = ["PENDING_VERIFICATION", "ACTIVE", "REVOKED"] as const;
export type AuthMethodStatus = (typeof AUTH_METHOD_STATUSES)[number];

export const RECOVERY_REQUEST_STATUSES = [
  "REQUESTED", "VERIFIED", "COMPLETED", "EXPIRED", "REJECTED",
] as const;
export type RecoveryRequestStatus = (typeof RECOVERY_REQUEST_STATUSES)[number];

export const CONSENT_STATUSES = ["GRANTED", "WITHDRAWN"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const EXPORT_STATUSES = ["REQUESTED", "PROCESSING", "READY", "FAILED", "EXPIRED"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const DELETION_STATUSES = [
  "REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED", "CANCELLED",
] as const;
export type DeletionStatus = (typeof DELETION_STATUSES)[number];

/** Purposes backed by implemented product behaviour only. */
export const PRIVACY_PURPOSES = [
  { code: "ACCOUNT_OPERATION", version: "1.0", label: "Account and wallet operation", description: "Required to provide your Nexus Pay account, wallet and payments.", required: true },
  { code: "SECURITY_FRAUD_PREVENTION", version: "1.0", label: "Security and fraud prevention", description: "Used to detect unauthorized access and protect accounts.", required: true },
  { code: "FINANCIAL_INSIGHTS", version: "1.0", label: "Financial insights", description: "Used to derive insights and reports from your own records.", required: false },
  { code: "EXTERNAL_ACCOUNT_AGGREGATION", version: "1.0", label: "External account aggregation", description: "Used only where you grant a provider-specific consent.", required: false },
  { code: "PRODUCT_ANALYTICS", version: "1.0", label: "Product usage analytics", description: "Aggregated product usage measurements. Never consent to transactions.", required: false },
] as const;

export interface AuthMethodView {
  id: string;
  type: AuthMethodType;
  status: AuthMethodStatus;
  label: string | null;
  createdAt: string;
  verifiedAt: string | null;
  lastUsedAt: string | null;
  available: boolean;
  notice: string;
}

export interface RecoveryCodeResult {
  codes: string[];
  notice: string;
}

export interface StepUpResult {
  grantToken: string;
  expiresAt: string;
  action: string;
  notice: string;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresAt: string;
  notice: string;
}

export interface IdentitySecurityOverviewView {
  lastLoginAt: string | null;
  activeSessions: number;
  trustedDevices: number;
  authMethods: AuthMethodView[];
  recentEvents: Array<{ id: string; type: string; occurredAt: string; sourceModule: string }>;
  unreadSecurityNotifications: number;
  notices: string[];
}

export interface PrivacyConsentView {
  id: string;
  purpose: string;
  label: string;
  version: string;
  status: ConsentStatus;
  source: string;
  dataCategories: string[];
  grantedAt: string;
  withdrawnAt: string | null;
  required: boolean;
}

export interface DataExportView {
  id: string;
  status: ExportStatus;
  format: string;
  fileName: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface DataDeletionView {
  id: string;
  status: DeletionStatus;
  reason: string;
  createdAt: string;
  reviewedBy: string | null;
  completedAt: string | null;
}

export interface IdentitySecurityOperationsView {
  events: Array<{
    id: string; type: string; actorId: string | null; subjectId: string | null;
    occurredAt: string; sourceModule: string;
  }>;
  incidents: Array<{
    id: string; subjectUserId: string; type: string; status: string;
    severity: string; summary: string; openedAt: string;
  }>;
  recoveryRequests: Array<{
    id: string; userId: string; status: string; createdAt: string;
  }>;
  deletionRequests: Array<{
    id: string; userId: string; status: string; reason: string; createdAt: string;
  }>;
  actions: Array<{
    id: string; actorId: string; action: string; targetType: string;
    targetId: string; reason: string; outcome: string; createdAt: string;
  }>;
  notice: string;
}
