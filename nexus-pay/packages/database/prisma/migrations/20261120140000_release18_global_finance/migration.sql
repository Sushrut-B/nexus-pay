-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_RATE_ALERT_TRIGGERED';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_RATE_SYNC_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_FX_QUOTE_READY';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_FX_QUOTE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_TRANSFER_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_TRANSFER_RECONCILIATION_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_COMPLIANCE_REVIEW';
ALTER TYPE "NotificationType" ADD VALUE 'GLOBAL_VALUATION_READY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_DISPLAY_CURRENCY_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_FX_CONVERSION_VIEWED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_BENEFICIARY_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_BENEFICIARY_ACCESSED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_TRANSFER_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_TRANSFER_STATUS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_PROVIDER_CONFIG_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_RECONCILIATION_RESOLVED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_COMPLIANCE_STATE_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_ALERT_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'GLOBAL_RATE_MANUAL_EDIT_BLOCKED';

-- CreateTable
CREATE TABLE "global_user_preferences" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "displayCurrency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL,
    "quoteCurrency" VARCHAR(3) NOT NULL,
    "rateText" VARCHAR(48) NOT NULL,
    "classification" VARCHAR(24) NOT NULL,
    "providerCode" VARCHAR(60) NOT NULL,
    "sourceRef" VARCHAR(160),
    "asOf" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "precision" INTEGER NOT NULL DEFAULT 6,
    "isHistorical" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_sync_jobs" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "providerCode" VARCHAR(60),
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

    CONSTRAINT "fx_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_watchlists" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "pairs" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_alerts" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "baseCurrency" VARCHAR(3) NOT NULL,
    "quoteCurrency" VARCHAR(3) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "targetRateText" VARCHAR(48),
    "changePercentBps" INTEGER,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastTriggeredAt" TIMESTAMP(3),
    "classification" VARCHAR(24) NOT NULL DEFAULT 'REFERENCE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_accounts" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "providerCode" VARCHAR(60) NOT NULL,
    "accountType" VARCHAR(60) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "originalBalanceMinor" BIGINT NOT NULL,
    "classification" VARCHAR(30) NOT NULL,
    "verificationStatus" VARCHAR(30) NOT NULL DEFAULT 'UNVERIFIED',
    "connectionStatus" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "sourceRef" VARCHAR(160),
    "isWallet" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_balance_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" VARCHAR(80) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "balance" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "sourceRef" VARCHAR(160),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foreign_assets_liabilities" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "originalMinor" BIGINT NOT NULL,
    "originalCurrency" VARCHAR(3) NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "rateText" VARCHAR(48),
    "rateSource" VARCHAR(60),
    "verificationStatus" VARCHAR(30) NOT NULL DEFAULT 'USER_REPORTED',
    "sourceRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "foreign_assets_liabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'QUOTE_REQUESTED',
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "targetCurrency" VARCHAR(3) NOT NULL,
    "sourceMinor" BIGINT NOT NULL,
    "targetMinor" BIGINT,
    "rateText" VARCHAR(48),
    "classification" VARCHAR(24) NOT NULL DEFAULT 'INDICATIVE',
    "providerCode" VARCHAR(60) NOT NULL,
    "providerFeeMinor" BIGINT,
    "taxMinor" BIGINT,
    "expiresAt" TIMESTAMP(3),
    "providerRef" VARCHAR(160),
    "payableMinor" BIGINT,
    "receivableMinor" BIGINT,
    "idempotencyKey" VARCHAR(120),
    "confirmation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "international_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corridor_configurations" (
    "id" TEXT NOT NULL,
    "providerCode" VARCHAR(60) NOT NULL,
    "sourceCountry" VARCHAR(2) NOT NULL,
    "destinationCountry" VARCHAR(2) NOT NULL,
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "targetCurrency" VARCHAR(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notice" VARCHAR(500),

    CONSTRAINT "corridor_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_beneficiaries" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "country" VARCHAR(2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "bankName" VARCHAR(160),
    "encryptedDetails" TEXT NOT NULL,
    "accountMasked" VARCHAR(40) NOT NULL,
    "paymentMethod" VARCHAR(60) NOT NULL,
    "providerRef" VARCHAR(160),
    "verificationStatus" VARCHAR(30) NOT NULL DEFAULT 'VERIFICATION_PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "international_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_transfers" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    "beneficiaryId" VARCHAR(80) NOT NULL,
    "sourceCurrency" VARCHAR(3) NOT NULL,
    "targetCurrency" VARCHAR(3) NOT NULL,
    "sourceMinor" BIGINT NOT NULL,
    "targetMinor" BIGINT,
    "feeMinor" BIGINT,
    "providerCode" VARCHAR(60) NOT NULL,
    "providerRef" VARCHAR(160),
    "complianceState" VARCHAR(30) NOT NULL DEFAULT 'VERIFICATION_PENDING',
    "walletSettlementRef" VARCHAR(160),
    "purposeCode" VARCHAR(40) NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "failureReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "international_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_transfer_events" (
    "id" TEXT NOT NULL,
    "transferId" VARCHAR(80) NOT NULL,
    "state" VARCHAR(30) NOT NULL,
    "detail" VARCHAR(500),
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "international_transfer_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_payment_webhooks" (
    "id" TEXT NOT NULL,
    "providerCode" VARCHAR(60) NOT NULL,
    "eventId" VARCHAR(160) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "lastError" VARCHAR(500),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "international_payment_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_reconciliations" (
    "id" TEXT NOT NULL,
    "transferId" VARCHAR(80) NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "outcome" VARCHAR(30) NOT NULL,
    "detail" VARCHAR(500),
    "resolvedBy" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "international_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "international_compliance_checks" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "transferId" VARCHAR(80),
    "kind" VARCHAR(60) NOT NULL,
    "state" VARCHAR(30) NOT NULL,
    "providerRef" VARCHAR(160),
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "international_compliance_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foreign_expenses" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "originalMinor" BIGINT NOT NULL,
    "originalCurrency" VARCHAR(3) NOT NULL,
    "convertedMinor" BIGINT,
    "displayCurrency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "category" VARCHAR(30) NOT NULL,
    "merchant" VARCHAR(200),
    "country" VARCHAR(2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" VARCHAR(80),
    "exchangeRateText" VARCHAR(48),
    "fxFeeMinor" BIGINT,
    "sourceProvider" VARCHAR(60) NOT NULL DEFAULT 'USER',
    "verificationStatus" VARCHAR(30) NOT NULL DEFAULT 'USER_REPORTED',
    "sourceRef" VARCHAR(160),
    "travelId" VARCHAR(80),

    CONSTRAINT "foreign_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_cash_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "tripId" VARCHAR(80) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "startingMinor" BIGINT NOT NULL,
    "receivedMinor" BIGINT NOT NULL DEFAULT 0,
    "spentMinor" BIGINT NOT NULL DEFAULT 0,
    "userReportedRate" VARCHAR(48),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_cash_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_insights" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "detail" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rateSource" VARCHAR(60),
    "rateAsOf" TIMESTAMP(3),
    "calculationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "methodology" TEXT NOT NULL,
    "dataUsed" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "global_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_audit_events" (
    "id" TEXT NOT NULL,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_user_preferences_userId_key" ON "global_user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "fx_providers_code_key" ON "fx_providers"("code");

-- CreateIndex
CREATE INDEX "fx_rates_baseCurrency_quoteCurrency_fetchedAt_idx" ON "fx_rates"("baseCurrency", "quoteCurrency", "fetchedAt");

-- CreateIndex
CREATE INDEX "fx_rates_providerCode_classification_asOf_idx" ON "fx_rates"("providerCode", "classification", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "fx_sync_jobs_idempotencyKey_key" ON "fx_sync_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "fx_sync_jobs_status_nextAttemptAt_idx" ON "fx_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "fx_sync_jobs_kind_createdAt_idx" ON "fx_sync_jobs"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "currency_watchlists_userId_createdAt_idx" ON "currency_watchlists"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "rate_alerts_userId_createdAt_idx" ON "rate_alerts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "rate_alerts_paused_baseCurrency_quoteCurrency_idx" ON "rate_alerts"("paused", "baseCurrency", "quoteCurrency");

-- CreateIndex
CREATE INDEX "global_accounts_userId_currency_idx" ON "global_accounts"("userId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "global_accounts_userId_providerCode_sourceRef_key" ON "global_accounts"("userId", "providerCode", "sourceRef");

-- CreateIndex
CREATE INDEX "global_balance_snapshots_accountId_capturedAt_idx" ON "global_balance_snapshots"("accountId", "capturedAt");

-- CreateIndex
CREATE INDEX "foreign_assets_liabilities_userId_kind_idx" ON "foreign_assets_liabilities"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "fx_quotes_idempotencyKey_key" ON "fx_quotes"("idempotencyKey");

-- CreateIndex
CREATE INDEX "fx_quotes_userId_createdAt_idx" ON "fx_quotes"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "fx_quotes_state_expiresAt_idx" ON "fx_quotes"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "international_providers_code_key" ON "international_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "corridor_configurations_providerCode_sourceCountry_destinat_key" ON "corridor_configurations"("providerCode", "sourceCountry", "destinationCountry", "sourceCurrency", "targetCurrency");

-- CreateIndex
CREATE INDEX "international_beneficiaries_userId_createdAt_idx" ON "international_beneficiaries"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "international_transfers_idempotencyKey_key" ON "international_transfers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "international_transfers_userId_createdAt_idx" ON "international_transfers"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "international_transfers_state_providerRef_idx" ON "international_transfers"("state", "providerRef");

-- CreateIndex
CREATE INDEX "international_transfer_events_transferId_createdAt_idx" ON "international_transfer_events"("transferId", "createdAt");

-- CreateIndex
CREATE INDEX "international_payment_webhooks_processed_receivedAt_idx" ON "international_payment_webhooks"("processed", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "international_payment_webhooks_providerCode_eventId_key" ON "international_payment_webhooks"("providerCode", "eventId");

-- CreateIndex
CREATE INDEX "international_reconciliations_transferId_createdAt_idx" ON "international_reconciliations"("transferId", "createdAt");

-- CreateIndex
CREATE INDEX "international_compliance_checks_userId_createdAt_idx" ON "international_compliance_checks"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "foreign_expenses_userId_occurredAt_idx" ON "foreign_expenses"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "foreign_expenses_userId_country_idx" ON "foreign_expenses"("userId", "country");

-- CreateIndex
CREATE UNIQUE INDEX "foreign_expenses_userId_sourceProvider_sourceRef_key" ON "foreign_expenses"("userId", "sourceProvider", "sourceRef");

-- CreateIndex
CREATE INDEX "travel_cash_records_userId_tripId_idx" ON "travel_cash_records"("userId", "tripId");

-- CreateIndex
CREATE INDEX "global_insights_userId_calculationDate_idx" ON "global_insights"("userId", "calculationDate");

-- CreateIndex
CREATE INDEX "global_audit_events_actorId_createdAt_idx" ON "global_audit_events"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "global_audit_events_action_createdAt_idx" ON "global_audit_events"("action", "createdAt");

