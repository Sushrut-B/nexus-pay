-- AlterEnum (Release 19 support security events)
ALTER TYPE "SecurityEventType" ADD VALUE 'SUPPORT_CASE_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SUPPORT_CASE_ESCALATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SUPPORT_CASE_RESOLVED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SUPPORT_EVIDENCE_ACCESSED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SUPPORT_SENSITIVE_CONTENT_FLAGGED';
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_CASE_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_CASE_ASSIGNED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_MESSAGE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_INFO_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_PROVIDER_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_RESOLUTION_PROPOSED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_CASE_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_CASE_REOPENED';
ALTER TYPE "NotificationType" ADD VALUE 'SUPPORT_CASE_STATUS_CHANGED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'SUPPORT_AGENT';
ALTER TYPE "AdminRole" ADD VALUE 'SUPPORT_SUPERVISOR';

-- CreateTable
CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "priority" VARCHAR(12) NOT NULL DEFAULT 'NORMAL',
    "description" TEXT NOT NULL,
    "guidedAnswers" JSONB NOT NULL DEFAULT '{}',
    "linkType" VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
    "linkedReference" VARCHAR(160),
    "linkedSummary" VARCHAR(500),
    "authoritativeStatus" VARCHAR(80),
    "assignedTo" VARCHAR(80),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "nextAction" VARCHAR(200),
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "resolutionSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_case_events" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "detail" VARCHAR(1000) NOT NULL,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "actorLabel" VARCHAR(120) NOT NULL,
    "customerVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "senderType" VARCHAR(30) NOT NULL,
    "senderId" VARCHAR(80) NOT NULL,
    "senderLabel" VARCHAR(120) NOT NULL,
    "senderRole" VARCHAR(40) NOT NULL DEFAULT 'CUSTOMER',
    "body" TEXT NOT NULL,
    "visibility" VARCHAR(24) NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    "idempotencyKey" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_message_attachments" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "messageId" VARCHAR(80),
    "userId" VARCHAR(80) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" VARCHAR(400) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "visibility" VARCHAR(24) NOT NULL DEFAULT 'CUSTOMER_VISIBLE',
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "support_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_message_read_states" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_message_read_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_case_assignments" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "assigneeId" VARCHAR(80) NOT NULL,
    "assignedBy" VARCHAR(80) NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "support_case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_priority_history" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "priority" VARCHAR(12) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "changedBy" VARCHAR(80) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_priority_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_escalations" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "signal" VARCHAR(80) NOT NULL,
    "escalatedBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "support_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_resolutions" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(160),
    "proposedBy" VARCHAR(80) NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedBy" VARCHAR(80),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "support_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_linked_operations" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "operationRef" VARCHAR(160) NOT NULL,
    "ownerVerified" BOOLEAN NOT NULL DEFAULT false,
    "authoritativeStatus" VARCHAR(80),
    "providerReference" VARCHAR(160),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_linked_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_provider_inquiries" (
    "id" TEXT NOT NULL,
    "caseId" VARCHAR(80) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "operationRef" VARCHAR(160) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "requestedBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "support_provider_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticleCategory" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HelpArticleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_articles" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "categoryCode" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "relatedSlugs" JSONB NOT NULL DEFAULT '[]',
    "lastReviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_article_versions" (
    "id" TEXT NOT NULL,
    "articleId" VARCHAR(80) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "createdBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_article_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "help_article_feedback" (
    "id" TEXT NOT NULL,
    "articleId" VARCHAR(80) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "help_article_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "caseUpdates" BOOLEAN NOT NULL DEFAULT true,
    "messages" BOOLEAN NOT NULL DEFAULT true,
    "resolutionNotices" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notification_events" (
    "id" TEXT NOT NULL,
    "eventKey" VARCHAR(160) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "caseId" VARCHAR(80),
    "type" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_jobs" (
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

    CONSTRAINT "support_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_audit_events" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_reference_key" ON "support_cases"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_idempotencyKey_key" ON "support_cases"("idempotencyKey");

-- CreateIndex
CREATE INDEX "support_cases_userId_createdAt_idx" ON "support_cases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_cases_status_priority_lastActivityAt_idx" ON "support_cases"("status", "priority", "lastActivityAt");

-- CreateIndex
CREATE INDEX "support_cases_assignedTo_status_idx" ON "support_cases"("assignedTo", "status");

-- CreateIndex
CREATE INDEX "support_case_events_caseId_createdAt_idx" ON "support_case_events"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_idempotencyKey_key" ON "support_messages"("idempotencyKey");

-- CreateIndex
CREATE INDEX "support_messages_caseId_createdAt_idx" ON "support_messages"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "support_message_attachments_caseId_uploadedAt_idx" ON "support_message_attachments"("caseId", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_message_read_states_caseId_userId_key" ON "support_message_read_states"("caseId", "userId");

-- CreateIndex
CREATE INDEX "support_case_assignments_caseId_assignedAt_idx" ON "support_case_assignments"("caseId", "assignedAt");

-- CreateIndex
CREATE INDEX "support_priority_history_caseId_changedAt_idx" ON "support_priority_history"("caseId", "changedAt");

-- CreateIndex
CREATE INDEX "support_escalations_caseId_createdAt_idx" ON "support_escalations"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "support_resolutions_caseId_proposedAt_idx" ON "support_resolutions"("caseId", "proposedAt");

-- CreateIndex
CREATE INDEX "support_linked_operations_caseId_createdAt_idx" ON "support_linked_operations"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_linked_operations_caseId_module_operationRef_key" ON "support_linked_operations"("caseId", "module", "operationRef");

-- CreateIndex
CREATE UNIQUE INDEX "support_provider_inquiries_caseId_module_operationRef_key" ON "support_provider_inquiries"("caseId", "module", "operationRef");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticleCategory_code_key" ON "HelpArticleCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "help_articles_slug_key" ON "help_articles"("slug");

-- CreateIndex
CREATE INDEX "help_articles_categoryCode_status_idx" ON "help_articles"("categoryCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "help_article_versions_articleId_version_key" ON "help_article_versions"("articleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "help_article_feedback_articleId_userId_key" ON "help_article_feedback"("articleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "support_notification_preferences_userId_key" ON "support_notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "support_notification_events_eventKey_key" ON "support_notification_events"("eventKey");

-- CreateIndex
CREATE INDEX "support_notification_events_userId_createdAt_idx" ON "support_notification_events"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_jobs_idempotencyKey_key" ON "support_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "support_jobs_status_nextAttemptAt_idx" ON "support_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "support_jobs_kind_createdAt_idx" ON "support_jobs"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "support_audit_events_actorId_createdAt_idx" ON "support_audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "support_audit_events_action_createdAt_idx" ON "support_audit_events"("action", "createdAt");

