-- CreateEnum
CREATE TYPE "TaxRegime" AS ENUM ('OLD', 'NEW');

-- CreateEnum
CREATE TYPE "TaxFinancialYearStatus" AS ENUM ('OPEN', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxIncomeCategory" AS ENUM ('SALARY', 'BUSINESS', 'INTEREST', 'DIVIDEND', 'RENTAL', 'CAPITAL_GAINS', 'OTHER', 'PENSION', 'FOREIGN', 'USER_DECLARED');

-- CreateEnum
CREATE TYPE "TaxClassificationStatus" AS ENUM ('UNCLASSIFIED', 'POTENTIALLY_TAXABLE', 'TAX_EXEMPT', 'TAXABLE', 'NON_TAXABLE', 'REQUIRES_REVIEW', 'USER_CONFIRMED');

-- CreateEnum
CREATE TYPE "TaxSourceType" AS ENUM ('PROVIDER', 'USER_DECLARED', 'DOCUMENT', 'SYSTEM_DERIVED');

-- CreateEnum
CREATE TYPE "TaxDocumentStatus" AS ENUM ('PENDING', 'READY', 'EXTRACTED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "TaxCalculationStatus" AS ENUM ('DRAFT', 'COMPLETED', 'REQUIRES_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxMatchLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "TaxReconciliationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TaxJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "TaxCapitalGainType" AS ENUM ('SHORT_TERM', 'LONG_TERM', 'EXEMPT', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "TaxDeadlineStatus" AS ENUM ('PENDING', 'COMPLETED', 'OVERDUE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TAX_CALCULATION_READY';
ALTER TYPE "NotificationType" ADD VALUE 'TAX_DOCUMENT_PROCESSED';
ALTER TYPE "NotificationType" ADD VALUE 'TAX_DEADLINE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TAX_RECONCILIATION_REQUIRED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'TAX_CALCULATION_READY';
ALTER TYPE "SecurityEventType" ADD VALUE 'TAX_DOCUMENT_PROCESSED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TAX_DEADLINE_REMINDER';
ALTER TYPE "SecurityEventType" ADD VALUE 'TAX_RECONCILIATION_REQUIRED';

-- CreateTable
CREATE TABLE "tax_rule_sets" (
    "id" TEXT NOT NULL,
    "version" VARCHAR(60) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "assessmentYear" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "sourceRef" VARCHAR(500) NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rule_sources" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rule_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_slabs" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "fromMinor" INTEGER NOT NULL,
    "toMinor" INTEGER,
    "rateBps" INTEGER NOT NULL,
    "baseTaxMinor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_deduction_rules" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "section" VARCHAR(80) NOT NULL,
    "maxMinor" INTEGER NOT NULL,
    "conditions" VARCHAR(500),
    "applicable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tax_deduction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exemption_rules" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "maxMinor" INTEGER NOT NULL,
    "conditions" VARCHAR(500),

    CONSTRAINT "tax_exemption_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_deadlines" (
    "id" TEXT NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "sourceRef" VARCHAR(500) NOT NULL,
    "status" "TaxDeadlineStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_profiles" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "panMasked" VARCHAR(30),
    "panEncrypted" VARCHAR(1024),
    "resident" BOOLEAN NOT NULL DEFAULT true,
    "ageCategory" VARCHAR(20) NOT NULL DEFAULT 'BELOW_60',
    "defaultRegime" "TaxRegime" NOT NULL DEFAULT 'NEW',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_financial_years" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "assessmentYear" VARCHAR(20) NOT NULL,
    "status" "TaxFinancialYearStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_financial_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_income_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "category" "TaxIncomeCategory" NOT NULL,
    "classification" "TaxClassificationStatus" NOT NULL DEFAULT 'UNCLASSIFIED',
    "sourceType" "TaxSourceType" NOT NULL DEFAULT 'SYSTEM_DERIVED',
    "sourceModule" VARCHAR(60) NOT NULL,
    "sourceRef" VARCHAR(160),
    "providerRef" VARCHAR(160),
    "description" VARCHAR(300) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "assumptions" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_income_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_deduction_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "ruleCode" VARCHAR(80) NOT NULL,
    "section" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "date" TIMESTAMP(3),
    "sourceType" "TaxSourceType" NOT NULL DEFAULT 'USER_DECLARED',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "includeInEstimate" BOOLEAN NOT NULL DEFAULT true,
    "documentId" VARCHAR(80),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_deduction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_payment_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "sourceType" "TaxSourceType" NOT NULL DEFAULT 'USER_DECLARED',
    "sourceRef" VARCHAR(160),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_credit_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "sourceType" "TaxSourceType" NOT NULL DEFAULT 'USER_DECLARED',
    "sourceRef" VARCHAR(160),
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_credit_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_capital_gain_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "assetType" VARCHAR(60) NOT NULL,
    "gainType" "TaxCapitalGainType" NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "purchaseMinor" INTEGER,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "saleMinor" INTEGER NOT NULL,
    "costMinor" INTEGER,
    "gainMinor" INTEGER NOT NULL,
    "instrumentRef" VARCHAR(160),
    "providerRef" VARCHAR(160),
    "completeness" VARCHAR(30) NOT NULL DEFAULT 'PARTIAL',
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_capital_gain_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_loss_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "gainType" "TaxCapitalGainType" NOT NULL,
    "lossMinor" INTEGER NOT NULL,
    "remainingMinor" INTEGER NOT NULL,
    "originRef" VARCHAR(160),
    "expiryDate" TIMESTAMP(3),
    "status" VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_loss_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_reconciliation_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "sourceRef" VARCHAR(200) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "matchLevel" "TaxMatchLevel" NOT NULL DEFAULT 'UNMATCHED',
    "matchedRef" VARCHAR(160),
    "status" "TaxReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_documents" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "kind" VARCHAR(80) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" VARCHAR(1024),
    "status" "TaxDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" VARCHAR(160),
    "duplicateOf" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_document_extractions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "field" VARCHAR(80) NOT NULL,
    "value" VARCHAR(300) NOT NULL,
    "confidenceBps" INTEGER NOT NULL DEFAULT 0,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_document_verifications" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_document_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_document_access_logs" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_document_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_calculations" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "regime" "TaxRegime" NOT NULL,
    "ruleSetVersion" VARCHAR(60) NOT NULL,
    "status" "TaxCalculationStatus" NOT NULL DEFAULT 'DRAFT',
    "grossMinor" INTEGER NOT NULL DEFAULT 0,
    "taxableMinor" INTEGER NOT NULL DEFAULT 0,
    "taxBeforeCreditsMinor" INTEGER NOT NULL DEFAULT 0,
    "rebateMinor" INTEGER NOT NULL DEFAULT 0,
    "surchargeMinor" INTEGER NOT NULL DEFAULT 0,
    "cessMinor" INTEGER NOT NULL DEFAULT 0,
    "creditsMinor" INTEGER NOT NULL DEFAULT 0,
    "netTaxMinor" INTEGER NOT NULL DEFAULT 0,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_calculation_line_items" (
    "id" TEXT NOT NULL,
    "calculationId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "detail" VARCHAR(500),

    CONSTRAINT "tax_calculation_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_regime_comparisons" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "oldCalculationId" VARCHAR(80) NOT NULL,
    "newCalculationId" VARCHAR(80) NOT NULL,
    "differenceMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_regime_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_planning_scenarios" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "financialYear" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "assumptions" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_planning_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_planning_scenario_inputs" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "valueMinor" INTEGER NOT NULL,

    CONSTRAINT "tax_planning_scenario_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_sync_jobs" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "TaxJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "tax_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_sync_history" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "detail" VARCHAR(500),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "tax_sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_reminders" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "deadlineId" VARCHAR(80),
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaxDeadlineStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_audit_events" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rule_sets_version_key" ON "tax_rule_sets"("version");

-- CreateIndex
CREATE INDEX "tax_rule_sets_financialYear_status_idx" ON "tax_rule_sets"("financialYear", "status");

-- CreateIndex
CREATE INDEX "tax_rule_sources_ruleSetId_idx" ON "tax_rule_sources"("ruleSetId");

-- CreateIndex
CREATE INDEX "tax_slabs_ruleSetId_regime_idx" ON "tax_slabs"("ruleSetId", "regime");

-- CreateIndex
CREATE UNIQUE INDEX "tax_deduction_rules_ruleSetId_regime_code_key" ON "tax_deduction_rules"("ruleSetId", "regime", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_exemption_rules_ruleSetId_regime_code_key" ON "tax_exemption_rules"("ruleSetId", "regime", "code");

-- CreateIndex
CREATE INDEX "tax_deadlines_dueDate_idx" ON "tax_deadlines"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "tax_deadlines_financialYear_code_key" ON "tax_deadlines"("financialYear", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_profiles_userId_key" ON "tax_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_financial_years_userId_financialYear_key" ON "tax_financial_years"("userId", "financialYear");

-- CreateIndex
CREATE INDEX "tax_income_records_userId_financialYear_idx" ON "tax_income_records"("userId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "tax_income_records_userId_sourceModule_sourceRef_key" ON "tax_income_records"("userId", "sourceModule", "sourceRef");

-- CreateIndex
CREATE INDEX "tax_deduction_records_userId_financialYear_regime_idx" ON "tax_deduction_records"("userId", "financialYear", "regime");

-- CreateIndex
CREATE INDEX "tax_payment_records_userId_financialYear_idx" ON "tax_payment_records"("userId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "tax_payment_records_userId_financialYear_kind_sourceRef_key" ON "tax_payment_records"("userId", "financialYear", "kind", "sourceRef");

-- CreateIndex
CREATE INDEX "tax_credit_records_userId_financialYear_idx" ON "tax_credit_records"("userId", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "tax_credit_records_userId_financialYear_kind_sourceRef_key" ON "tax_credit_records"("userId", "financialYear", "kind", "sourceRef");

-- CreateIndex
CREATE INDEX "tax_capital_gain_records_userId_financialYear_idx" ON "tax_capital_gain_records"("userId", "financialYear");

-- CreateIndex
CREATE INDEX "tax_loss_records_userId_financialYear_idx" ON "tax_loss_records"("userId", "financialYear");

-- CreateIndex
CREATE INDEX "tax_reconciliation_records_userId_status_idx" ON "tax_reconciliation_records"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_reconciliation_records_userId_category_sourceRef_key" ON "tax_reconciliation_records"("userId", "category", "sourceRef");

-- CreateIndex
CREATE INDEX "tax_documents_userId_financialYear_kind_idx" ON "tax_documents"("userId", "financialYear", "kind");

-- CreateIndex
CREATE INDEX "tax_document_extractions_documentId_idx" ON "tax_document_extractions"("documentId");

-- CreateIndex
CREATE INDEX "tax_document_verifications_documentId_idx" ON "tax_document_verifications"("documentId");

-- CreateIndex
CREATE INDEX "tax_document_access_logs_documentId_createdAt_idx" ON "tax_document_access_logs"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_calculations_userId_createdAt_idx" ON "tax_calculations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_calculation_line_items_calculationId_idx" ON "tax_calculation_line_items"("calculationId");

-- CreateIndex
CREATE INDEX "tax_regime_comparisons_userId_createdAt_idx" ON "tax_regime_comparisons"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_planning_scenarios_userId_createdAt_idx" ON "tax_planning_scenarios"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_planning_scenario_inputs_scenarioId_idx" ON "tax_planning_scenario_inputs"("scenarioId");

-- CreateIndex
CREATE INDEX "tax_sync_jobs_status_nextAttemptAt_idx" ON "tax_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "tax_sync_history_userId_startedAt_idx" ON "tax_sync_history"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "tax_reminders_status_dueAt_idx" ON "tax_reminders"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "tax_reminders_userId_deadlineId_dueAt_key" ON "tax_reminders"("userId", "deadlineId", "dueAt");

-- CreateIndex
CREATE INDEX "tax_audit_events_actorId_createdAt_idx" ON "tax_audit_events"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "tax_slabs" ADD CONSTRAINT "tax_slabs_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "tax_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_deduction_rules" ADD CONSTRAINT "tax_deduction_rules_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "tax_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exemption_rules" ADD CONSTRAINT "tax_exemption_rules_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "tax_rule_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_document_extractions" ADD CONSTRAINT "tax_document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "tax_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_calculation_line_items" ADD CONSTRAINT "tax_calculation_line_items_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "tax_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_planning_scenario_inputs" ADD CONSTRAINT "tax_planning_scenario_inputs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "tax_planning_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
