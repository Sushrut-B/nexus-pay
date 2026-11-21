-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_MFA_ENABLED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_MFA_DISABLED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_RECOVERY_CODE_USED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_ACCOUNT_RECOVERY';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_PRIVACY_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_DATA_EXPORT_READY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'SECURITY_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE 'SECURITY_ANALYST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'MFA_ENROLLMENT_STARTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MFA_DISABLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'RECOVERY_CODE_USED';
ALTER TYPE "SecurityEventType" ADD VALUE 'RECOVERY_CODES_REGENERATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ACCOUNT_RECOVERY_COMPLETED';
ALTER TYPE "SecurityEventType" ADD VALUE 'PRIVACY_CONSENT_UPDATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DATA_EXPORT_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DATA_EXPORT_READY';
ALTER TYPE "SecurityEventType" ADD VALUE 'DATA_DELETION_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'DATA_DELETION_REVIEWED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_SESSION_REVOKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'ADMIN_RECOVERY_REVIEWED';
ALTER TYPE "SecurityEventType" ADD VALUE 'STEP_UP_VERIFIED';
ALTER TYPE "SecurityEventType" ADD VALUE 'STEP_UP_FAILED';

-- CreateTable
CREATE TABLE "auth_methods" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "label" VARCHAR(120),
    "encryptedSecret" TEXT,
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "auth_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "authMethodId" VARCHAR(80),
    "codeHash" VARCHAR(64) NOT NULL,
    "hint" VARCHAR(20),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_grants" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "sessionId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_recovery_requests" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reason" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_consents" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "purpose" VARCHAR(80) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'GRANTED',
    "source" VARCHAR(60) NOT NULL,
    "dataCategories" JSONB NOT NULL DEFAULT '[]',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_consent_events" (
    "id" TEXT NOT NULL,
    "consentId" VARCHAR(80) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'REQUESTED',
    "format" VARCHAR(10) NOT NULL DEFAULT 'JSON',
    "fileName" VARCHAR(200),
    "storagePath" VARCHAR(400),
    "sha256" VARCHAR(64),
    "expiresAt" TIMESTAMP(3),
    "failureReason" VARCHAR(500),
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "reviewedBy" VARCHAR(80),
    "reviewNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_notification_events" (
    "id" TEXT NOT NULL,
    "eventKey" VARCHAR(180) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_jobs" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" VARCHAR(1000),
    "idempotencyKey" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_security_actions" (
    "id" TEXT NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "outcome" VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_security_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_incidents" (
    "id" TEXT NOT NULL,
    "subjectUserId" VARCHAR(80) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "severity" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
    "summary" VARCHAR(1000) NOT NULL,
    "resolutionNote" VARCHAR(1000),
    "openedBy" VARCHAR(80) NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" VARCHAR(80),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "security_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_methods_userId_type_status_idx" ON "auth_methods"("userId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recovery_codes_codeHash_key" ON "recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "recovery_codes_userId_usedAt_idx" ON "recovery_codes"("userId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_tokenHash_key" ON "mfa_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "mfa_challenges_userId_expiresAt_idx" ON "mfa_challenges"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "step_up_grants_tokenHash_key" ON "step_up_grants"("tokenHash");

-- CreateIndex
CREATE INDEX "step_up_grants_userId_sessionId_action_idx" ON "step_up_grants"("userId", "sessionId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "account_recovery_requests_tokenHash_key" ON "account_recovery_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "account_recovery_requests_userId_createdAt_idx" ON "account_recovery_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "account_recovery_requests_status_expiresAt_idx" ON "account_recovery_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "privacy_consents_userId_status_idx" ON "privacy_consents"("userId", "status");

-- CreateIndex
CREATE INDEX "privacy_consents_userId_purpose_version_idx" ON "privacy_consents"("userId", "purpose", "version");

-- CreateIndex
CREATE INDEX "privacy_consent_events_consentId_createdAt_idx" ON "privacy_consent_events"("consentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "data_export_requests_idempotencyKey_key" ON "data_export_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "data_export_requests_userId_createdAt_idx" ON "data_export_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "data_export_requests_status_expiresAt_idx" ON "data_export_requests"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "data_deletion_requests_idempotencyKey_key" ON "data_deletion_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "data_deletion_requests_userId_createdAt_idx" ON "data_deletion_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "data_deletion_requests_status_createdAt_idx" ON "data_deletion_requests"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "security_notification_events_eventKey_key" ON "security_notification_events"("eventKey");

-- CreateIndex
CREATE INDEX "security_notification_events_userId_createdAt_idx" ON "security_notification_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "security_jobs_idempotencyKey_key" ON "security_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "security_jobs_status_nextAttemptAt_idx" ON "security_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "security_jobs_kind_createdAt_idx" ON "security_jobs"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "admin_security_actions_actorId_createdAt_idx" ON "admin_security_actions"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_security_actions_action_createdAt_idx" ON "admin_security_actions"("action", "createdAt");

-- CreateIndex
CREATE INDEX "security_incidents_status_openedAt_idx" ON "security_incidents"("status", "openedAt");

-- CreateIndex
CREATE INDEX "security_incidents_subjectUserId_openedAt_idx" ON "security_incidents"("subjectUserId", "openedAt");

