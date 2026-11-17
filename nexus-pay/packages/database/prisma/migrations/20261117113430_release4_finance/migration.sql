-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('FOOD_DINING', 'GROCERIES', 'SHOPPING', 'TRANSPORT', 'TRAVEL', 'ENTERTAINMENT', 'RENT_HOUSING', 'UTILITIES', 'HEALTHCARE', 'EDUCATION', 'SUBSCRIPTIONS', 'PERSONAL_TRANSFERS', 'GROUP_EXPENSES', 'INCOME', 'OTHER', 'UNCATEGORIZED');

-- CreateEnum
CREATE TYPE "CategorizationSource" AS ENUM ('SYSTEM_RULE', 'USER_RULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "RuleConditionType" AS ENUM ('CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'EXACT');

-- CreateEnum
CREATE TYPE "BudgetPeriodType" AS ENUM ('WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SavingsGoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContributionType" AS ENUM ('PLANNED', 'RECORDED');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REQUIRES_ATTENTION');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'RETRY_PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RecurringSuggestionStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'IGNORED');

-- CreateEnum
CREATE TYPE "StatementFormat" AS ENUM ('PDF', 'CSV');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('GENERATING', 'READY', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BUDGET_THRESHOLD_REACHED';
ALTER TYPE "NotificationType" ADD VALUE 'BUDGET_EXCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_PAYMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_PAYMENT_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_PAYMENT_ATTENTION';
ALTER TYPE "NotificationType" ADD VALUE 'SAVINGS_GOAL_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'STATEMENT_AVAILABLE';

-- CreateTable
CREATE TABLE "transaction_categories" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" VARCHAR(60) NOT NULL,
    "categoryType" "CategoryType" NOT NULL,
    "icon" VARCHAR(40),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_categorizations" (
    "id" TEXT NOT NULL,
    "paymentRef" VARCHAR(80) NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "note" VARCHAR(200),
    "categorizationSource" "CategorizationSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_categorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conditionType" "RuleConditionType" NOT NULL,
    "conditionValue" VARCHAR(120) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "periodType" "BudgetPeriodType" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "BudgetStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_alerts" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "thresholdPercentage" INTEGER NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "targetAmountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "targetDate" TIMESTAMP(3),
    "description" VARCHAR(400),
    "icon" VARCHAR(40),
    "status" "SavingsGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_contributions" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "contributionType" "ContributionType" NOT NULL,
    "relatedPaymentRef" VARCHAR(80),
    "note" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "sourceWalletId" TEXT NOT NULL,
    "destinationWalletId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" VARCHAR(200),
    "frequency" "ScheduleFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextExecutionAt" TIMESTAMP(3) NOT NULL,
    "maxExecutions" INTEGER,
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_payment_executions" (
    "id" TEXT NOT NULL,
    "scheduledPaymentId" TEXT NOT NULL,
    "executionKey" VARCHAR(120) NOT NULL,
    "paymentRef" VARCHAR(80),
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "nextAttemptAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_payment_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_payment_suggestions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counterparty" VARCHAR(80) NOT NULL,
    "counterpartyUsername" VARCHAR(30),
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "suggestedFrequency" "RecurringFrequency" NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "nextExpectedAt" TIMESTAMP(3),
    "confidence" INTEGER NOT NULL,
    "status" "RecurringSuggestionStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_payment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "format" "StatementFormat" NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'GENERATING',
    "fileName" VARCHAR(200),
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_categories_isSystem_categoryType_idx" ON "transaction_categories"("isSystem", "categoryType");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categories_userId_name_key" ON "transaction_categories"("userId", "name");

-- CreateIndex
CREATE INDEX "transaction_categorizations_categoryId_idx" ON "transaction_categorizations"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categorizations_userId_paymentRef_key" ON "transaction_categorizations"("userId", "paymentRef");

-- CreateIndex
CREATE INDEX "categorization_rules_userId_isEnabled_priority_idx" ON "categorization_rules"("userId", "isEnabled", "priority");

-- CreateIndex
CREATE INDEX "budgets_userId_status_startDate_idx" ON "budgets"("userId", "status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "budget_alerts_budgetId_periodStart_thresholdPercentage_key" ON "budget_alerts"("budgetId", "periodStart", "thresholdPercentage");

-- CreateIndex
CREATE INDEX "savings_goals_userId_status_idx" ON "savings_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "savings_contributions_goalId_createdAt_idx" ON "savings_contributions"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_payments_userId_status_nextExecutionAt_idx" ON "scheduled_payments"("userId", "status", "nextExecutionAt");

-- CreateIndex
CREATE INDEX "scheduled_payments_status_nextExecutionAt_idx" ON "scheduled_payments"("status", "nextExecutionAt");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_payment_executions_executionKey_key" ON "scheduled_payment_executions"("executionKey");

-- CreateIndex
CREATE INDEX "scheduled_payment_executions_scheduledPaymentId_scheduledFo_idx" ON "scheduled_payment_executions"("scheduledPaymentId", "scheduledFor");

-- CreateIndex
CREATE INDEX "scheduled_payment_executions_status_nextAttemptAt_idx" ON "scheduled_payment_executions"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "recurring_payment_suggestions_userId_status_idx" ON "recurring_payment_suggestions"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_payment_suggestions_userId_counterpartyUsername_a_key" ON "recurring_payment_suggestions"("userId", "counterpartyUsername", "amountMinor");

-- CreateIndex
CREATE INDEX "statements_userId_createdAt_idx" ON "statements"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_categorizations" ADD CONSTRAINT "transaction_categorizations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_categorizations" ADD CONSTRAINT "transaction_categorizations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "transaction_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "transaction_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "transaction_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_contributions" ADD CONSTRAINT "savings_contributions_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "savings_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_destinationWalletId_fkey" FOREIGN KEY ("destinationWalletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payment_executions" ADD CONSTRAINT "scheduled_payment_executions_scheduledPaymentId_fkey" FOREIGN KEY ("scheduledPaymentId") REFERENCES "scheduled_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payment_suggestions" ADD CONSTRAINT "recurring_payment_suggestions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
