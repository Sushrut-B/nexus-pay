-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RecurrencePatternStatus" AS ENUM ('DETECTED', 'CONFIRMED', 'IGNORED', 'PAUSED', 'DELETED');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'EXPECTED', 'DISMISSED', 'REVIEWED');

-- CreateEnum
CREATE TYPE "HealthAvailability" AS ENUM ('AVAILABLE', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('ACTIVE', 'DISMISSED', 'USEFUL');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinancialReportType" AS ENUM ('MONTHLY_SUMMARY', 'ANNUAL_SUMMARY', 'CATEGORY_EXPENDITURE', 'MERCHANT_EXPENDITURE', 'SUBSCRIPTION', 'RECURRING_PAYMENT', 'BUDGET_PERFORMANCE', 'SAVINGS_GOAL');

-- CreateEnum
CREATE TYPE "FinancialReportFormat" AS ENUM ('PDF', 'CSV');

-- CreateEnum
CREATE TYPE "FinancialReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_INSIGHT_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_ANOMALY_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_FORECAST_READY';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_BUDGET_RECOMMENDATION';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_GOAL_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_REPORT_READY';
ALTER TYPE "NotificationType" ADD VALUE 'FINANCE_RECURRING_DETECTED';

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "priority" VARCHAR(20) NOT NULL DEFAULT 'MEDIUM';

-- CreateTable
CREATE TABLE "financial_transaction_classifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "description" VARCHAR(300),
    "merchantName" VARCHAR(120),
    "classificationSource" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_transaction_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_category_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pattern" VARCHAR(120) NOT NULL,
    "targetCategory" VARCHAR(40) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_category_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_data_quality_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "issueCode" VARCHAR(60) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "details" VARCHAR(500),
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_data_quality_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_aggregation_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodKey" VARCHAR(60) NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_aggregation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expense_patterns" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantKey" VARCHAR(160) NOT NULL,
    "descriptionKey" VARCHAR(160),
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "confidence" VARCHAR(20) NOT NULL,
    "status" "RecurrencePatternStatus" NOT NULL DEFAULT 'DETECTED',
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "nextExpectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_expense_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_expense_evidence" (
    "id" TEXT NOT NULL,
    "patternId" TEXT NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_expense_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_forecasts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "predictedMinor" INTEGER NOT NULL,
    "lowMinor" INTEGER NOT NULL,
    "highMinor" INTEGER NOT NULL,
    "method" VARCHAR(80) NOT NULL,
    "assumptions" JSONB NOT NULL,
    "historyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spending_anomalies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" VARCHAR(40) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "severity" "AnomalySeverity" NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "baselineMinor" INTEGER NOT NULL,
    "observedMinor" INTEGER NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spending_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_health_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "overallScore" INTEGER,
    "availability" "HealthAvailability" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_health_dimensions" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "score" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "explanation" JSONB NOT NULL,

    CONSTRAINT "financial_health_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_insights" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "data" JSONB NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_insight_feedback" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "useful" BOOLEAN NOT NULL,
    "note" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_insight_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_recommendations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" VARCHAR(40) NOT NULL,
    "suggestedMinor" INTEGER NOT NULL,
    "historicalAverageMinor" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'SUGGESTED',
    "budgetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_assistant_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_assistant_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FinancialReportType" NOT NULL,
    "format" "FinancialReportFormat" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "FinancialReportStatus" NOT NULL DEFAULT 'PENDING',
    "fileName" VARCHAR(200),
    "fileSize" INTEGER,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "financial_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_report_jobs" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultPeriod" VARCHAR(30) NOT NULL DEFAULT 'month',
    "dashboardLayout" JSONB,
    "insightNotifications" BOOLEAN NOT NULL DEFAULT true,
    "forecastNotifications" BOOLEAN NOT NULL DEFAULT false,
    "budgetRecommendationNotifications" BOOLEAN NOT NULL DEFAULT true,
    "recurringDetection" BOOLEAN NOT NULL DEFAULT true,
    "goalReminders" BOOLEAN NOT NULL DEFAULT true,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_transaction_classifications_userId_occurredAt_idx" ON "financial_transaction_classifications"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "financial_transaction_classifications_userId_category_occur_idx" ON "financial_transaction_classifications"("userId", "category", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transaction_classifications_sourceType_sourceId_key" ON "financial_transaction_classifications"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_category_mappings_userId_pattern_key" ON "financial_category_mappings"("userId", "pattern");

-- CreateIndex
CREATE INDEX "financial_data_quality_events_status_createdAt_idx" ON "financial_data_quality_events"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_data_quality_events_sourceType_sourceId_issueCode_key" ON "financial_data_quality_events"("sourceType", "sourceId", "issueCode");

-- CreateIndex
CREATE INDEX "financial_aggregation_snapshots_userId_kind_periodEnd_idx" ON "financial_aggregation_snapshots"("userId", "kind", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "financial_aggregation_snapshots_userId_periodKey_kind_key" ON "financial_aggregation_snapshots"("userId", "periodKey", "kind");

-- CreateIndex
CREATE INDEX "recurring_expense_patterns_userId_status_idx" ON "recurring_expense_patterns"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_expense_patterns_userId_merchantKey_frequency_key" ON "recurring_expense_patterns"("userId", "merchantKey", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_expense_evidence_patternId_sourceId_key" ON "recurring_expense_evidence"("patternId", "sourceId");

-- CreateIndex
CREATE INDEX "financial_forecasts_userId_kind_createdAt_idx" ON "financial_forecasts"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "spending_anomalies_userId_status_createdAt_idx" ON "spending_anomalies"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "spending_anomalies_sourceType_sourceId_reason_key" ON "spending_anomalies"("sourceType", "sourceId", "reason");

-- CreateIndex
CREATE INDEX "financial_health_snapshots_userId_computedAt_idx" ON "financial_health_snapshots"("userId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_health_dimensions_snapshotId_key_key" ON "financial_health_dimensions"("snapshotId", "key");

-- CreateIndex
CREATE INDEX "financial_insights_userId_status_createdAt_idx" ON "financial_insights"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_insights_userId_kind_title_key" ON "financial_insights"("userId", "kind", "title");

-- CreateIndex
CREATE UNIQUE INDEX "financial_insight_feedback_insightId_userId_key" ON "financial_insight_feedback"("insightId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_recommendations_userId_category_key" ON "budget_recommendations"("userId", "category");

-- CreateIndex
CREATE INDEX "finance_assistant_conversations_userId_updatedAt_idx" ON "finance_assistant_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "finance_assistant_messages_conversationId_createdAt_idx" ON "finance_assistant_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "financial_reports_userId_createdAt_idx" ON "financial_reports"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_report_jobs_reportId_key" ON "financial_report_jobs"("reportId");

-- CreateIndex
CREATE INDEX "financial_report_jobs_status_nextAttemptAt_idx" ON "financial_report_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "financial_preferences_userId_key" ON "financial_preferences"("userId");

-- AddForeignKey
ALTER TABLE "recurring_expense_evidence" ADD CONSTRAINT "recurring_expense_evidence_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "recurring_expense_patterns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_health_dimensions" ADD CONSTRAINT "financial_health_dimensions_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "financial_health_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_insight_feedback" ADD CONSTRAINT "financial_insight_feedback_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "financial_insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_assistant_messages" ADD CONSTRAINT "finance_assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "finance_assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_report_jobs" ADD CONSTRAINT "financial_report_jobs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "financial_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
