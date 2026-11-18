-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLATION_SCHEDULED', 'CANCELLED', 'EXPIRED', 'INCOMPLETE', 'REQUIRES_CUSTOMER_ACTION');

-- CreateEnum
CREATE TYPE "CancellationTiming" AS ENUM ('IMMEDIATE', 'END_OF_PERIOD');

-- CreateEnum
CREATE TYPE "BillingOccurrenceStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'UNRESOLVED', 'RECONCILIATION_REQUIRED', 'DEAD_LETTER', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PROCESSING', 'PAID', 'PAST_DUE', 'VOID', 'UNCOLLECTIBLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_TRIAL_ENDING';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_PAST_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_PLAN_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_INVOICE_AVAILABLE';

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "imageUrl" VARCHAR(2048),
    "amountMinor" INTEGER NOT NULL,
    "setupFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "frequency" "BillingFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "introPriceMinor" INTEGER,
    "introPeriods" INTEGER NOT NULL DEFAULT 0,
    "maxBillingPeriods" INTEGER,
    "cancellationPolicy" VARCHAR(1000),
    "visibility" "PlanVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "checkoutToken" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "frequency" "BillingFrequency" NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "startDate" TIMESTAMP(3) NOT NULL,
    "trialEndDate" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" VARCHAR(500),
    "cancellationTiming" "CancellationTiming",
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_occurrences" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "occurrenceNumber" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "BillingOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "paymentIntentId" VARCHAR(80),
    "paymentRef" VARCHAR(80),
    "invoiceId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "failureCategory" VARCHAR(60),
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerUserId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "occurrenceId" TEXT,
    "invoiceNumber" VARCHAR(40) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "setupFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paymentRef" VARCHAR(80),
    "customerName" VARCHAR(120) NOT NULL,
    "customerEmail" VARCHAR(254) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_number_sequences" (
    "merchantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "invoice_number_sequences_pkey" PRIMARY KEY ("merchantId")
);

-- CreateTable
CREATE TABLE "plan_changes" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "fromPlanId" TEXT NOT NULL,
    "toPlanId" TEXT NOT NULL,
    "reason" VARCHAR(500),
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_checkoutToken_key" ON "subscription_plans"("checkoutToken");

-- CreateIndex
CREATE INDEX "subscription_plans_merchantId_status_idx" ON "subscription_plans"("merchantId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_merchantId_status_idx" ON "subscriptions"("merchantId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_customerUserId_status_idx" ON "subscriptions"("customerUserId", "status");

-- CreateIndex
CREATE INDEX "subscriptions_nextBillingDate_status_idx" ON "subscriptions"("nextBillingDate", "status");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_createdAt_idx" ON "subscription_events"("subscriptionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_occurrences_idempotencyKey_key" ON "billing_occurrences"("idempotencyKey");

-- CreateIndex
CREATE INDEX "billing_occurrences_status_availableAt_idx" ON "billing_occurrences"("status", "availableAt");

-- CreateIndex
CREATE INDEX "billing_occurrences_merchantId_status_idx" ON "billing_occurrences"("merchantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "billing_occurrences_subscriptionId_occurrenceNumber_key" ON "billing_occurrences"("subscriptionId", "occurrenceNumber");

-- CreateIndex
CREATE INDEX "invoices_merchantId_status_issueDate_idx" ON "invoices"("merchantId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_customerUserId_issueDate_idx" ON "invoices"("customerUserId", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_merchantId_invoiceNumber_key" ON "invoices"("merchantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- CreateIndex
CREATE INDEX "plan_changes_subscriptionId_createdAt_idx" ON "plan_changes"("subscriptionId", "createdAt");

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_occurrences" ADD CONSTRAINT "billing_occurrences_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_occurrences" ADD CONSTRAINT "billing_occurrences_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_number_sequences" ADD CONSTRAINT "invoice_number_sequences_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_fromPlanId_fkey" FOREIGN KEY ("fromPlanId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_changes" ADD CONSTRAINT "plan_changes_toPlanId_fkey" FOREIGN KEY ("toPlanId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
