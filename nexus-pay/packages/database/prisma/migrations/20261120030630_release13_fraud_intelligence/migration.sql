-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'NEW_DEVICE_LOGIN', 'SESSION_CREATED', 'SESSION_REVOKED', 'MFA_ENABLED', 'MFA_FAILED', 'PROFILE_CHANGED', 'EMAIL_CHANGED', 'PHONE_CHANGED', 'RECOVERY_DETAILS_CHANGED', 'WALLET_CREATED', 'ACCOUNT_RECOVERY_REQUESTED', 'PAYMENT_INITIATED', 'PAYMENT_REVIEWED', 'PAYMENT_PROCESSING', 'PAYMENT_SETTLED', 'PAYMENT_REJECTED', 'PAYMENT_UNKNOWN', 'PAYMENT_RECONCILIATION_REQUIRED', 'PAYMENT_CANCELLED', 'MERCHANT_REGISTERED', 'MERCHANT_SETTINGS_CHANGED', 'PAYMENT_LINK_CREATED', 'CHECKOUT_PAYMENT_INITIATED', 'REFUND_REQUESTED', 'WEBHOOK_CONFIGURATION_CHANGED', 'REWARD_EARNED', 'REWARD_REDEEMED', 'REFERRAL_CREATED', 'REFERRAL_REWARDED', 'CASHBACK_ISSUED', 'LOAN_APPLICATION_SUBMITTED', 'INSURANCE_QUOTE_REQUESTED', 'INSURANCE_APPLICATION_SUBMITTED', 'DOCUMENT_UPLOADED', 'PROVIDER_WEBHOOK_RECEIVED');

-- CreateEnum
CREATE TYPE "SecurityOutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "RiskClassification" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskAction" AS ENUM ('ALLOW', 'ALLOW_WITH_MONITORING', 'REQUIRE_STEP_UP_AUTHENTICATION', 'REQUIRE_CUSTOMER_CONFIRMATION', 'HOLD_FOR_MANUAL_REVIEW', 'BLOCK_INITIATION');

-- CreateEnum
CREATE TYPE "RiskEvaluationMode" AS ENUM ('SYNC_PRE_TRANSACTION', 'ASYNC_POST_TRANSACTION', 'PERIODIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "RiskSubjectType" AS ENUM ('USER', 'PAYMENT', 'MERCHANT', 'APPLICATION', 'SESSION', 'DEVICE');

-- CreateEnum
CREATE TYPE "FraudRuleCategory" AS ENUM ('AUTHENTICATION', 'PAYMENT', 'MERCHANT', 'REWARDS', 'APPLICATION', 'BEHAVIORAL', 'OPERATIONAL');

-- CreateEnum
CREATE TYPE "FraudRuleSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskAlertStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FraudCaseStatus" AS ENUM ('OPEN', 'TRIAGED', 'INVESTIGATING', 'CUSTOMER_CONTACT_REQUIRED', 'PROVIDER_CONTACT_REQUIRED', 'ESCALATED', 'RESOLVED', 'FALSE_POSITIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FraudCasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FraudReportStatus" AS ENUM ('SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RelationshipKind" AS ENUM ('SHARED_DEVICE', 'SHARED_IP', 'REFERRAL', 'PAYMENT_RECIPIENT', 'MERCHANT_ASSOCIATION', 'SHARED_ACCOUNT');

-- CreateEnum
CREATE TYPE "BehavioralMetric" AS ENUM ('TRANSACTION_AMOUNT', 'TRANSACTION_FREQUENCY', 'LOGIN_FREQUENCY', 'RECIPIENT_NOVELTY', 'FAILED_AUTH_COUNT');

-- CreateEnum
CREATE TYPE "FraudModelStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "SecurityAuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'INFO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminRole" ADD VALUE 'FRAUD_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE 'FRAUD_ANALYST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_NEW_DEVICE_LOGIN';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_SUSPICIOUS_LOGIN';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_RISK_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_SENSITIVE_ACTION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_SESSION_REVOKED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_DEVICE_TRUST_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_REPORT_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_CASE_UPDATE';
ALTER TYPE "NotificationType" ADD VALUE 'SECURITY_PAYMENT_WARNING';

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "eventId" VARCHAR(160) NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" VARCHAR(80),
    "subjectId" VARCHAR(120),
    "accountId" VARCHAR(120),
    "sessionId" VARCHAR(120),
    "sourceModule" VARCHAR(60) NOT NULL,
    "correlationId" VARCHAR(160),
    "requestId" VARCHAR(80),
    "deviceId" VARCHAR(160),
    "ipHash" VARCHAR(80),
    "transactionRef" VARCHAR(160),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "retentionExpiresAt" TIMESTAMP(3),

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_event_outbox" (
    "id" TEXT NOT NULL,
    "eventId" VARCHAR(160) NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "aggregateType" VARCHAR(60) NOT NULL,
    "aggregateId" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SecurityOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "deviceId" VARCHAR(160) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "userAgentHash" VARCHAR(80),
    "ipHash" VARCHAR(80),
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSessionId" VARCHAR(120),

    CONSTRAINT "device_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_session_risks" (
    "id" TEXT NOT NULL,
    "sessionId" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "deviceId" VARCHAR(160),
    "score" INTEGER NOT NULL DEFAULT 0,
    "classification" "RiskClassification" NOT NULL DEFAULT 'LOW',
    "flags" JSONB NOT NULL DEFAULT '{}',
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "deviceId" VARCHAR(160) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "trusted" BOOLEAN NOT NULL DEFAULT true,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_evaluations" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "mode" "RiskEvaluationMode" NOT NULL,
    "subjectType" "RiskSubjectType" NOT NULL,
    "subjectId" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80),
    "score" INTEGER NOT NULL,
    "classification" "RiskClassification" NOT NULL,
    "action" "RiskAction" NOT NULL,
    "triggeredRules" JSONB NOT NULL DEFAULT '[]',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "explanation" VARCHAR(1000),
    "evidenceQuality" VARCHAR(30) NOT NULL DEFAULT 'LIMITED',
    "rulesetVersion" VARCHAR(40) NOT NULL,
    "policyVersion" VARCHAR(40) NOT NULL,
    "modelVersion" VARCHAR(40),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_risk_signals" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "value" VARCHAR(160),
    "weight" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(60) NOT NULL,
    "evidence" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_risk_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rules" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "category" "FraudRuleCategory" NOT NULL,
    "severity" "FraudRuleSeverity" NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "windowSeconds" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "riskContribution" INTEGER NOT NULL DEFAULT 0,
    "recommendedAction" "RiskAction" NOT NULL DEFAULT 'ALLOW_WITH_MONITORING',
    "createdBy" VARCHAR(80) NOT NULL,
    "updatedBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rule_versions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_rule_executions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "evaluationId" VARCHAR(80),
    "matched" BOOLEAN NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_policies" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "actionMap" JSONB NOT NULL DEFAULT '{}',
    "fallbackAction" "RiskAction" NOT NULL DEFAULT 'REQUIRE_CUSTOMER_CONFIRMATION',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "behavioral_baselines" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "metric" "BehavioralMetric" NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "meanValue" DOUBLE PRECISION,
    "mdevValue" DOUBLE PRECISION,
    "ewmaValue" DOUBLE PRECISION,
    "lastValue" DOUBLE PRECISION,
    "coldStart" BOOLEAN NOT NULL DEFAULT true,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "behavioral_baselines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_alerts" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "userId" VARCHAR(80),
    "evaluationId" VARCHAR(80),
    "score" INTEGER NOT NULL,
    "severity" "FraudRuleSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "RiskAlertStatus" NOT NULL DEFAULT 'NEW',
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "triggeredRules" JSONB NOT NULL DEFAULT '[]',
    "assignedTo" VARCHAR(80),
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_cases" (
    "id" TEXT NOT NULL,
    "caseNumber" VARCHAR(80) NOT NULL,
    "userId" VARCHAR(80),
    "accountId" VARCHAR(120),
    "transactionRef" VARCHAR(160),
    "merchantId" VARCHAR(120),
    "alertId" VARCHAR(80),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "status" "FraudCaseStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "FraudCasePriority" NOT NULL DEFAULT 'MEDIUM',
    "assignedTo" VARCHAR(80),
    "resolution" VARCHAR(500),
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_evidence" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "reference" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_notes" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" VARCHAR(80) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_case_assignments" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromUserId" VARCHAR(80),
    "toUserId" VARCHAR(80),
    "assignedBy" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_case_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_fraud_reports" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(160) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "transactionRef" VARCHAR(160),
    "category" VARCHAR(80) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "FraudReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "resolution" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "customer_fraud_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_fraud_report_documents" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" VARCHAR(1024) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'READY',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_fraud_report_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_risk_assessments" (
    "id" TEXT NOT NULL,
    "clientRequestId" VARCHAR(160),
    "paymentIntentId" VARCHAR(160),
    "userId" VARCHAR(80) NOT NULL,
    "amountMinor" INTEGER,
    "evaluationId" VARCHAR(80) NOT NULL,
    "action" "RiskAction" NOT NULL,
    "outcome" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "originalIdempotencyKey" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_notifications" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500),
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_feature_snapshots" (
    "id" TEXT NOT NULL,
    "evaluationId" VARCHAR(80) NOT NULL,
    "featureVersion" VARCHAR(40) NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_feature_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_model_versions" (
    "id" TEXT NOT NULL,
    "version" VARCHAR(60) NOT NULL,
    "owner" VARCHAR(120) NOT NULL,
    "datasetRef" VARCHAR(200) NOT NULL,
    "featureVersion" VARCHAR(40) NOT NULL,
    "evaluationSummary" JSONB NOT NULL DEFAULT '{}',
    "status" "FraudModelStatus" NOT NULL DEFAULT 'DRAFT',
    "advisoryOnly" BOOLEAN NOT NULL DEFAULT true,
    "deployedAt" TIMESTAMP(3),
    "rollbackOf" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_model_evaluations" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "notes" VARCHAR(500),
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_model_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audit_events" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "justification" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "outcome" "SecurityAuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_relationships" (
    "id" TEXT NOT NULL,
    "kind" "RelationshipKind" NOT NULL,
    "fromKey" VARCHAR(160) NOT NULL,
    "toKey" VARCHAR(160) NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 1,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_events_eventId_key" ON "security_events"("eventId");

-- CreateIndex
CREATE INDEX "security_events_type_occurredAt_idx" ON "security_events"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "security_events_actorId_occurredAt_idx" ON "security_events"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "security_events_subjectId_type_idx" ON "security_events"("subjectId", "type");

-- CreateIndex
CREATE INDEX "security_events_correlationId_idx" ON "security_events"("correlationId");

-- CreateIndex
CREATE INDEX "security_events_transactionRef_idx" ON "security_events"("transactionRef");

-- CreateIndex
CREATE UNIQUE INDEX "security_event_outbox_eventId_key" ON "security_event_outbox"("eventId");

-- CreateIndex
CREATE INDEX "security_event_outbox_status_nextAttemptAt_idx" ON "security_event_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "device_records_userId_lastSeen_idx" ON "device_records"("userId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "device_records_userId_deviceId_key" ON "device_records"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "user_session_risks_sessionId_key" ON "user_session_risks"("sessionId");

-- CreateIndex
CREATE INDEX "user_session_risks_userId_lastEvaluatedAt_idx" ON "user_session_risks"("userId", "lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "trusted_devices_userId_revokedAt_idx" ON "trusted_devices"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_userId_deviceId_key" ON "trusted_devices"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "risk_evaluations_reference_key" ON "risk_evaluations"("reference");

-- CreateIndex
CREATE INDEX "risk_evaluations_subjectType_subjectId_idx" ON "risk_evaluations"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "risk_evaluations_userId_createdAt_idx" ON "risk_evaluations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "risk_evaluations_classification_createdAt_idx" ON "risk_evaluations"("classification", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_risk_signals_evaluationId_idx" ON "fraud_risk_signals"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_rules_code_key" ON "fraud_rules"("code");

-- CreateIndex
CREATE INDEX "fraud_rules_category_enabled_idx" ON "fraud_rules"("category", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_rule_versions_ruleId_version_key" ON "fraud_rule_versions"("ruleId", "version");

-- CreateIndex
CREATE INDEX "fraud_rule_executions_ruleId_createdAt_idx" ON "fraud_rule_executions"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "risk_policies_code_key" ON "risk_policies"("code");

-- CreateIndex
CREATE UNIQUE INDEX "behavioral_baselines_userId_metric_key" ON "behavioral_baselines"("userId", "metric");

-- CreateIndex
CREATE UNIQUE INDEX "risk_alerts_reference_key" ON "risk_alerts"("reference");

-- CreateIndex
CREATE INDEX "risk_alerts_status_createdAt_idx" ON "risk_alerts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "risk_alerts_userId_createdAt_idx" ON "risk_alerts"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_cases_caseNumber_key" ON "fraud_cases"("caseNumber");

-- CreateIndex
CREATE INDEX "fraud_cases_status_priority_idx" ON "fraud_cases"("status", "priority");

-- CreateIndex
CREATE INDEX "fraud_cases_userId_createdAt_idx" ON "fraud_cases"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_case_evidence_caseId_createdAt_idx" ON "fraud_case_evidence"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_case_notes_caseId_createdAt_idx" ON "fraud_case_notes"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "fraud_case_assignments_caseId_createdAt_idx" ON "fraud_case_assignments"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_fraud_reports_reference_key" ON "customer_fraud_reports"("reference");

-- CreateIndex
CREATE INDEX "customer_fraud_reports_userId_createdAt_idx" ON "customer_fraud_reports"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_fraud_reports_status_createdAt_idx" ON "customer_fraud_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_fraud_report_documents_reportId_idx" ON "customer_fraud_report_documents"("reportId");

-- CreateIndex
CREATE INDEX "transaction_risk_assessments_userId_createdAt_idx" ON "transaction_risk_assessments"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "transaction_risk_assessments_paymentIntentId_idx" ON "transaction_risk_assessments"("paymentIntentId");

-- CreateIndex
CREATE INDEX "security_notifications_userId_status_idx" ON "security_notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "risk_feature_snapshots_evaluationId_idx" ON "risk_feature_snapshots"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_model_versions_version_key" ON "fraud_model_versions"("version");

-- CreateIndex
CREATE INDEX "fraud_model_versions_status_deployedAt_idx" ON "fraud_model_versions"("status", "deployedAt");

-- CreateIndex
CREATE INDEX "fraud_model_evaluations_modelId_evaluatedAt_idx" ON "fraud_model_evaluations"("modelId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "security_audit_events_actorId_createdAt_idx" ON "security_audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "security_audit_events_action_createdAt_idx" ON "security_audit_events"("action", "createdAt");

-- CreateIndex
CREATE INDEX "security_relationships_fromKey_idx" ON "security_relationships"("fromKey");

-- CreateIndex
CREATE INDEX "security_relationships_toKey_idx" ON "security_relationships"("toKey");

-- CreateIndex
CREATE UNIQUE INDEX "security_relationships_kind_fromKey_toKey_key" ON "security_relationships"("kind", "fromKey", "toKey");

-- AddForeignKey
ALTER TABLE "fraud_risk_signals" ADD CONSTRAINT "fraud_risk_signals_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "risk_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_rule_versions" ADD CONSTRAINT "fraud_rule_versions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "fraud_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_rule_executions" ADD CONSTRAINT "fraud_rule_executions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "fraud_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_evidence" ADD CONSTRAINT "fraud_case_evidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_notes" ADD CONSTRAINT "fraud_case_notes_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_case_assignments" ADD CONSTRAINT "fraud_case_assignments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "fraud_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_fraud_report_documents" ADD CONSTRAINT "customer_fraud_report_documents_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "customer_fraud_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_feature_snapshots" ADD CONSTRAINT "risk_feature_snapshots_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "risk_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_model_evaluations" ADD CONSTRAINT "fraud_model_evaluations_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "fraud_model_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
