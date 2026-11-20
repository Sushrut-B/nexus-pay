-- CreateEnum
CREATE TYPE "BillProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "BillCategory" AS ENUM ('ELECTRICITY', 'WATER', 'GAS', 'LPG', 'BROADBAND', 'LANDLINE', 'MOBILE_POSTPAID', 'MOBILE_PREPAID', 'DTH', 'FASTAG', 'MUNICIPAL_TAX', 'SOCIETY_MAINTENANCE', 'EDUCATION_FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "BillerType" AS ENUM ('POSTPAID', 'PREPAID');

-- CreateEnum
CREATE TYPE "BillFetchStatus" AS ENUM ('FETCH_REQUESTED', 'FETCH_PROCESSING', 'FETCHED', 'NOT_FOUND', 'INVALID_CUSTOMER_DETAILS', 'FETCH_FAILED', 'EXPIRED', 'PAID', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BillPaymentStatus" AS ENUM ('CREATED', 'CUSTOMER_CONFIRMATION_REQUIRED', 'PAYMENT_AUTHORIZED', 'WALLET_SETTLEMENT_PENDING', 'WALLET_SETTLED', 'PROVIDER_SUBMISSION_PENDING', 'PROVIDER_PROCESSING', 'BILLER_CONFIRMED', 'FAILED', 'UNKNOWN', 'RECONCILIATION_REQUIRED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REVERSED');

-- CreateEnum
CREATE TYPE "RechargeStatus" AS ENUM ('CREATED', 'VALIDATION_PENDING', 'VALIDATED', 'PAYMENT_PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'UNKNOWN', 'RECONCILIATION_REQUIRED', 'REFUND_PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "BillReminderStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillAutoPaymentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'REQUIRES_RAUTHORIZATION');

-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "BillReconciliationStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BillWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "BillSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BILL_FETCHED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_DUE_SOON';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_PAYMENT_INITIATED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_PAYMENT_WALLET_SETTLED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_PAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_PAYMENT_UNKNOWN';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_REFUND_INITIATED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_REFUND_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_RECHARGE_SUCCESSFUL';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_RECHARGE_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_RECURRING_DETECTED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_AUTO_PAYMENT_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE 'BILL_AUTO_PAYMENT_CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'BILLER_ACCOUNT_ADDED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BILL_FETCH_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BILL_PAYMENT_INITIATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BILL_PAYMENT_CONFIRMED';
ALTER TYPE "SecurityEventType" ADD VALUE 'BILL_PAYMENT_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'RECHARGE_INITIATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'RECHARGE_CONFIRMED';
ALTER TYPE "SecurityEventType" ADD VALUE 'RECHARGE_FAILED';
ALTER TYPE "SecurityEventType" ADD VALUE 'REPEATED_PAYMENT_ATTEMPT';
ALTER TYPE "SecurityEventType" ADD VALUE 'BILLER_DETAILS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'AUTOMATIC_PAYMENT_AUTHORIZED';
ALTER TYPE "SecurityEventType" ADD VALUE 'AUTOMATIC_PAYMENT_CANCELLED';

-- CreateTable
CREATE TABLE "bill_payment_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" "BillProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "status" VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
    "capabilities" JSONB NOT NULL,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_payment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_provider_capabilities" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bill_payment_provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biller_categories" (
    "id" TEXT NOT NULL,
    "code" "BillCategory" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "available" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "biller_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billers" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "billerType" "BillerType" NOT NULL DEFAULT 'POSTPAID',
    "coverage" VARCHAR(300),
    "canFetchBill" BOOLEAN NOT NULL DEFAULT false,
    "canPayBill" BOOLEAN NOT NULL DEFAULT false,
    "supportsRecharge" BOOLEAN NOT NULL DEFAULT false,
    "supportedModes" JSONB NOT NULL DEFAULT '[]',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biller_parameters" (
    "id" TEXT NOT NULL,
    "billerId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "biller_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biller_catalogue_versions" (
    "id" TEXT NOT NULL,
    "billerId" TEXT NOT NULL,
    "version" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biller_catalogue_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_biller_accounts" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "billerId" TEXT NOT NULL,
    "nickname" VARCHAR(120) NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "maskedIdentifier" VARCHAR(80) NOT NULL,
    "lastFetchAt" TIMESTAMP(3),
    "lastPaymentAt" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_biller_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_fetch_requests" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "billerId" TEXT NOT NULL,
    "accountId" VARCHAR(80),
    "status" "BillFetchStatus" NOT NULL DEFAULT 'FETCH_REQUESTED',
    "providerRef" VARCHAR(160),
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_fetch_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_snapshots" (
    "id" TEXT NOT NULL,
    "fetchRequestId" TEXT NOT NULL,
    "providerRef" VARCHAR(160),
    "billNumber" VARCHAR(120),
    "billPeriod" VARCHAR(120),
    "billDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "amountMinor" INTEGER NOT NULL,
    "minAmountMinor" INTEGER,
    "lateFeeMinor" INTEGER,
    "extraChargesMinor" INTEGER,
    "status" VARCHAR(40) NOT NULL DEFAULT 'FETCHED',
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "bill_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_intents" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "billerId" TEXT NOT NULL,
    "accountId" VARCHAR(80),
    "snapshotId" VARCHAR(80),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "providerRequestRef" VARCHAR(160) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "status" "BillPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "paymentIntentId" VARCHAR(120),
    "paymentRef" VARCHAR(160),
    "providerRef" VARCHAR(160),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_attempts" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "paymentIntentId" VARCHAR(120),
    "outcome" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_provider_transactions" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_provider_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_status_history" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromStatus" "BillPaymentStatus",
    "toStatus" "BillPaymentStatus" NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "evidence" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharge_plans" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "billerId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "validity" VARCHAR(80),
    "dataAllowance" VARCHAR(120),
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "terms" VARCHAR(500),
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recharge_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharge_plan_snapshots" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recharge_plan_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharge_intents" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "billerId" TEXT NOT NULL,
    "accountId" VARCHAR(80),
    "planId" VARCHAR(80),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "providerRequestRef" VARCHAR(160) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "RechargeStatus" NOT NULL DEFAULT 'CREATED',
    "paymentIntentId" VARCHAR(120),
    "paymentRef" VARCHAR(160),
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recharge_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recharge_attempts" (
    "id" TEXT NOT NULL,
    "rechargeId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recharge_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_receipts" (
    "id" TEXT NOT NULL,
    "paymentId" VARCHAR(80),
    "rechargeId" VARCHAR(80),
    "userId" VARCHAR(80) NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'NEXUS_PAYMENT_RECORD',
    "amountMinor" INTEGER NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "storagePath" VARCHAR(1024),
    "fileName" VARCHAR(200),
    "contentType" VARCHAR(100),
    "officialProviderReceipt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_bills" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "billerId" TEXT NOT NULL,
    "accountId" VARCHAR(80),
    "pattern" VARCHAR(30) NOT NULL DEFAULT 'MONTHLY',
    "expectedMinMinor" INTEGER,
    "expectedMaxMinor" INTEGER,
    "lastPaymentDate" TIMESTAMP(3),
    "nextExpectedDate" TIMESTAMP(3),
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_reminders" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "accountId" VARCHAR(80),
    "billerId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "BillReminderStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_auto_payment_authorizations" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "accountId" VARCHAR(80) NOT NULL,
    "recurringBillId" VARCHAR(80),
    "maxAmountMinor" INTEGER NOT NULL,
    "frequency" VARCHAR(30) NOT NULL,
    "status" "BillAutoPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextExecutionAt" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_auto_payment_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_reconciliation_cases" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "paymentId" VARCHAR(80),
    "rechargeId" VARCHAR(80),
    "userId" VARCHAR(80),
    "reason" VARCHAR(120) NOT NULL,
    "status" "BillReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" VARCHAR(120),
    "resolution" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "bill_reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "ownerId" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_bill_assignments" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "paymentId" VARCHAR(80),
    "accountId" VARCHAR(80),
    "billerId" TEXT NOT NULL,
    "assignedTo" VARCHAR(80),
    "createdBy" VARCHAR(80) NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_bill_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_provider_webhooks" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "eventId" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "BillWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" VARCHAR(500),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_provider_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_provider_syncs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "BillSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_provider_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payment_activities" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500),
    "reference" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payment_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_providers_code_key" ON "bill_payment_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_provider_capabilities_providerId_capability_key" ON "bill_payment_provider_capabilities"("providerId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "biller_categories_code_key" ON "biller_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "billers_code_key" ON "billers"("code");

-- CreateIndex
CREATE INDEX "billers_providerId_categoryId_status_idx" ON "billers"("providerId", "categoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "biller_parameters_billerId_name_key" ON "biller_parameters"("billerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "biller_catalogue_versions_billerId_version_key" ON "biller_catalogue_versions"("billerId", "version");

-- CreateIndex
CREATE INDEX "saved_biller_accounts_userId_status_idx" ON "saved_biller_accounts"("userId", "status");

-- CreateIndex
CREATE INDEX "bill_fetch_requests_userId_createdAt_idx" ON "bill_fetch_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bill_snapshots_fetchRequestId_fetchedAt_idx" ON "bill_snapshots"("fetchRequestId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_intents_reference_key" ON "bill_payment_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_intents_idempotencyKey_key" ON "bill_payment_intents"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_intents_providerRequestRef_key" ON "bill_payment_intents"("providerRequestRef");

-- CreateIndex
CREATE INDEX "bill_payment_intents_userId_createdAt_idx" ON "bill_payment_intents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payment_intents_status_createdAt_idx" ON "bill_payment_intents"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_attempts_paymentId_attemptNo_key" ON "bill_payment_attempts"("paymentId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "bill_provider_transactions_paymentId_providerRef_key" ON "bill_provider_transactions"("paymentId", "providerRef");

-- CreateIndex
CREATE INDEX "bill_payment_status_history_paymentId_createdAt_idx" ON "bill_payment_status_history"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recharge_plans_billerId_code_key" ON "recharge_plans"("billerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "recharge_intents_reference_key" ON "recharge_intents"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "recharge_intents_idempotencyKey_key" ON "recharge_intents"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "recharge_intents_providerRequestRef_key" ON "recharge_intents"("providerRequestRef");

-- CreateIndex
CREATE INDEX "recharge_intents_userId_createdAt_idx" ON "recharge_intents"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recharge_attempts_rechargeId_attemptNo_key" ON "recharge_attempts"("rechargeId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payment_receipts_reference_key" ON "bill_payment_receipts"("reference");

-- CreateIndex
CREATE INDEX "bill_payment_receipts_userId_createdAt_idx" ON "bill_payment_receipts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "recurring_bills_userId_status_idx" ON "recurring_bills"("userId", "status");

-- CreateIndex
CREATE INDEX "bill_reminders_status_dueAt_idx" ON "bill_reminders"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_reminders_userId_accountId_kind_dueAt_key" ON "bill_reminders"("userId", "accountId", "kind", "dueAt");

-- CreateIndex
CREATE INDEX "bill_auto_payment_authorizations_userId_status_idx" ON "bill_auto_payment_authorizations"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bill_reconciliation_cases_reference_key" ON "bill_reconciliation_cases"("reference");

-- CreateIndex
CREATE INDEX "bill_reconciliation_cases_status_createdAt_idx" ON "bill_reconciliation_cases"("status", "createdAt");

-- CreateIndex
CREATE INDEX "household_members_userId_status_idx" ON "household_members"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "household_members_householdId_userId_key" ON "household_members"("householdId", "userId");

-- CreateIndex
CREATE INDEX "household_bill_assignments_householdId_createdAt_idx" ON "household_bill_assignments"("householdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bill_provider_webhooks_providerId_eventId_key" ON "bill_provider_webhooks"("providerId", "eventId");

-- CreateIndex
CREATE INDEX "bill_provider_syncs_status_nextAttemptAt_idx" ON "bill_provider_syncs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "bill_payment_activities_userId_createdAt_idx" ON "bill_payment_activities"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "bill_payment_provider_capabilities" ADD CONSTRAINT "bill_payment_provider_capabilities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "bill_payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billers" ADD CONSTRAINT "billers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "bill_payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billers" ADD CONSTRAINT "billers_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "biller_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biller_parameters" ADD CONSTRAINT "biller_parameters_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "billers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biller_catalogue_versions" ADD CONSTRAINT "biller_catalogue_versions_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "billers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_biller_accounts" ADD CONSTRAINT "saved_biller_accounts_billerId_fkey" FOREIGN KEY ("billerId") REFERENCES "billers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_snapshots" ADD CONSTRAINT "bill_snapshots_fetchRequestId_fkey" FOREIGN KEY ("fetchRequestId") REFERENCES "bill_fetch_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_attempts" ADD CONSTRAINT "bill_payment_attempts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bill_payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_provider_transactions" ADD CONSTRAINT "bill_provider_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bill_payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_status_history" ADD CONSTRAINT "bill_payment_status_history_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bill_payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_plan_snapshots" ADD CONSTRAINT "recharge_plan_snapshots_planId_fkey" FOREIGN KEY ("planId") REFERENCES "recharge_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recharge_attempts" ADD CONSTRAINT "recharge_attempts_rechargeId_fkey" FOREIGN KEY ("rechargeId") REFERENCES "recharge_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payment_receipts" ADD CONSTRAINT "bill_payment_receipts_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bill_payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_bill_assignments" ADD CONSTRAINT "household_bill_assignments_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_provider_webhooks" ADD CONSTRAINT "bill_provider_webhooks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "bill_payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_provider_syncs" ADD CONSTRAINT "bill_provider_syncs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "bill_payment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
