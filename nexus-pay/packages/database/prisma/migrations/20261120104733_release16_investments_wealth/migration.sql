-- CreateEnum
CREATE TYPE "InvestmentProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "InvestmentConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTION_INITIATED', 'AUTHORIZATION_PENDING', 'ACTIVE', 'SYNCING', 'SYNC_FAILED', 'CONSENT_EXPIRED', 'REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "InvestmentConsentStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvestmentSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "InvestmentAccountType" AS ENUM ('MUTUAL_FUND', 'EQUITY', 'ETF', 'BOND', 'RETIREMENT', 'FIXED_INCOME', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentAssetClass" AS ENUM ('EQUITY', 'DEBT', 'HYBRID', 'INDEX', 'ELSS', 'LIQUID', 'INTERNATIONAL', 'SECTORAL', 'GOLD', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentTransactionType" AS ENUM ('PURCHASE', 'REDEMPTION', 'SIP', 'DIVIDEND', 'INTEREST', 'CORPORATE_ACTION', 'MATURITY', 'FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvestmentPlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED', 'PENDING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PriceFeedType" AS ENUM ('LIVE', 'DELAYED', 'EOD', 'SANDBOX');

-- CreateEnum
CREATE TYPE "InvestmentGoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvestmentSourceType" AS ENUM ('PROVIDER', 'USER_REPORTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "InvestmentDocumentStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_SYNC_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_PROVIDER_FAILURE';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_CONSENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_SIP_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_MATURITY_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_PRICE_ALERT';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_GOAL_MILESTONE';
ALTER TYPE "NotificationType" ADD VALUE 'INVESTMENT_DOCUMENT_AVAILABLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_CONNECTION_INITIATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_CONNECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_DISCONNECTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_SYNC_COMPLETED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_HOLDINGS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_GOAL_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'INVESTMENT_WATCHLIST_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'UNUSUAL_INVESTMENT_ACTIVITY';

-- CreateTable
CREATE TABLE "investment_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" "InvestmentProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "status" VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
    "capabilities" JSONB NOT NULL,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_provider_capabilities" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "investment_provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_connections" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "InvestmentConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "providerRef" VARCHAR(160),
    "maskedLabel" VARCHAR(120),
    "encryptedCredentials" VARCHAR(2048),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_consents" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerConsentRef" VARCHAR(160),
    "status" "InvestmentConsentStatus" NOT NULL DEFAULT 'PENDING',
    "purpose" VARCHAR(300) NOT NULL,
    "dataCategories" TEXT[],
    "termsVersion" VARCHAR(40) NOT NULL,
    "consentedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_consent_events" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_sync_jobs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "InvestmentSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "investment_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_sync_history" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "accountsSeen" INTEGER NOT NULL DEFAULT 0,
    "holdingsSeen" INTEGER NOT NULL DEFAULT 0,
    "transactionsSeen" INTEGER NOT NULL DEFAULT 0,
    "detail" VARCHAR(500),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "investment_sync_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_accounts" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "accountType" "InvestmentAccountType" NOT NULL DEFAULT 'OTHER',
    "maskedNumber" VARCHAR(80),
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'PROVIDER',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_holdings" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "instrumentId" VARCHAR(80),
    "name" VARCHAR(200) NOT NULL,
    "assetClass" "InvestmentAssetClass" NOT NULL DEFAULT 'OTHER',
    "quantityMinor" INTEGER,
    "navMinor" INTEGER,
    "costMinor" INTEGER,
    "valueMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'PROVIDER',
    "providerReportedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_transactions" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "type" "InvestmentTransactionType" NOT NULL DEFAULT 'OTHER',
    "quantityMinor" INTEGER,
    "priceMinor" INTEGER,
    "amountMinor" INTEGER NOT NULL,
    "chargesMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "providerStatus" VARCHAR(60),
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'PROVIDER',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_valuations" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "accountId" TEXT NOT NULL,
    "valueMinor" INTEGER NOT NULL,
    "costMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "valuedAt" TIMESTAMP(3) NOT NULL,
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'PROVIDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_documents" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "connectionId" VARCHAR(80),
    "accountId" VARCHAR(80),
    "kind" VARCHAR(60) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" VARCHAR(1024),
    "status" "InvestmentDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_instruments" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "symbol" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "exchange" VARCHAR(40),
    "category" "InvestmentAssetClass" NOT NULL DEFAULT 'EQUITY',
    "sector" VARCHAR(80),
    "details" JSONB NOT NULL DEFAULT '{}',
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instrument_price_history" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "changeMinor" INTEGER NOT NULL DEFAULT 0,
    "changePct" INTEGER NOT NULL DEFAULT 0,
    "feedType" "PriceFeedType" NOT NULL DEFAULT 'SANDBOX',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrument_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mutual_fund_schemes" (
    "id" TEXT NOT NULL,
    "providerId" TEXT,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "amc" VARCHAR(160) NOT NULL,
    "category" "InvestmentAssetClass" NOT NULL DEFAULT 'EQUITY',
    "planType" VARCHAR(20) NOT NULL DEFAULT 'DIRECT',
    "optionType" VARCHAR(20) NOT NULL DEFAULT 'GROWTH',
    "navMinor" INTEGER,
    "navDate" TIMESTAMP(3),
    "expenseRatioBps" INTEGER,
    "inceptionDate" TIMESTAMP(3),
    "minInvestmentMinor" INTEGER,
    "minSipMinor" INTEGER,
    "exitLoad" VARCHAR(300),
    "riskometer" VARCHAR(40),
    "benchmark" VARCHAR(160),
    "performance" JSONB NOT NULL DEFAULT '{}',
    "documents" JSONB NOT NULL DEFAULT '[]',
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutual_fund_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_watchlists" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_watchlist_items" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_price_alerts" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "direction" VARCHAR(10) NOT NULL,
    "thresholdMinor" INTEGER NOT NULL,
    "lastTriggeredAt" TIMESTAMP(3),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_plans" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(40) NOT NULL DEFAULT 'SIP_PLANNER',
    "input" JSONB NOT NULL DEFAULT '{}',
    "projection" JSONB NOT NULL DEFAULT '{}',
    "isExecution" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sip_tracking_records" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "connectionId" VARCHAR(80),
    "schemeCode" VARCHAR(100) NOT NULL,
    "schemeName" VARCHAR(200) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "frequency" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3),
    "nextInstalmentDate" TIMESTAMP(3),
    "instalmentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "investedMinor" INTEGER NOT NULL DEFAULT 0,
    "currentValueMinor" INTEGER,
    "status" "InvestmentPlanStatus" NOT NULL DEFAULT 'UNKNOWN',
    "providerRef" VARCHAR(160),
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'PROVIDER',
    "providerReportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_tracking_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_goals" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "goalType" VARCHAR(60) NOT NULL,
    "targetAmountMinor" INTEGER NOT NULL,
    "targetDate" TIMESTAMP(3),
    "currentAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "monthlyTargetMinor" INTEGER,
    "status" "InvestmentGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_goal_contributions" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "kind" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "note" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_goal_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_income_assets" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "connectionId" VARCHAR(80),
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "principalMinor" INTEGER NOT NULL,
    "interestRateBps" INTEGER,
    "maturityDate" TIMESTAMP(3),
    "interestFrequency" VARCHAR(40),
    "currentValueMinor" INTEGER,
    "accruedInterestMinor" INTEGER,
    "creditRating" VARCHAR(40),
    "issuer" VARCHAR(160),
    "source" "InvestmentSourceType" NOT NULL DEFAULT 'USER_REPORTED',
    "providerRef" VARCHAR(160),
    "riskDisclosure" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_income_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "net_worth_snapshots" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "totalAssetsMinor" INTEGER NOT NULL,
    "totalLiabilitiesMinor" INTEGER NOT NULL,
    "netWorthMinor" INTEGER NOT NULL,
    "walletMinor" INTEGER NOT NULL DEFAULT 0,
    "bankMinor" INTEGER NOT NULL DEFAULT 0,
    "investmentsMinor" INTEGER NOT NULL DEFAULT 0,
    "fixedIncomeMinor" INTEGER NOT NULL DEFAULT 0,
    "liabilitiesMinor" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL DEFAULT '{}',
    "completeness" VARCHAR(30) NOT NULL DEFAULT 'PARTIAL',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "investedMinor" INTEGER NOT NULL,
    "currentValueMinor" INTEGER NOT NULL,
    "absoluteReturnMinor" INTEGER NOT NULL,
    "returnPctBps" INTEGER NOT NULL,
    "holdingsCount" INTEGER NOT NULL DEFAULT 0,
    "allocation" JSONB NOT NULL DEFAULT '{}',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_allocation_snapshots" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "dimension" VARCHAR(40) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "valueMinor" INTEGER NOT NULL,
    "pctBps" INTEGER NOT NULL,

    CONSTRAINT "portfolio_allocation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_insights" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "explanation" VARCHAR(1000) NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "dataAsOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_analytics_jobs" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "investment_analytics_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_providers_code_key" ON "investment_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "investment_provider_capabilities_providerId_capability_key" ON "investment_provider_capabilities"("providerId", "capability");

-- CreateIndex
CREATE INDEX "investment_connections_userId_status_idx" ON "investment_connections"("userId", "status");

-- CreateIndex
CREATE INDEX "investment_consents_userId_status_idx" ON "investment_consents"("userId", "status");

-- CreateIndex
CREATE INDEX "investment_consent_events_consentId_createdAt_idx" ON "investment_consent_events"("consentId", "createdAt");

-- CreateIndex
CREATE INDEX "investment_sync_jobs_status_nextAttemptAt_idx" ON "investment_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "investment_sync_history_connectionId_startedAt_idx" ON "investment_sync_history"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "investment_accounts_userId_status_idx" ON "investment_accounts"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "investment_accounts_connectionId_providerRef_key" ON "investment_accounts"("connectionId", "providerRef");

-- CreateIndex
CREATE INDEX "investment_holdings_userId_assetClass_idx" ON "investment_holdings"("userId", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "investment_holdings_accountId_providerRef_key" ON "investment_holdings"("accountId", "providerRef");

-- CreateIndex
CREATE INDEX "investment_transactions_userId_occurredAt_idx" ON "investment_transactions"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_accountId_providerRef_key" ON "investment_transactions"("accountId", "providerRef");

-- CreateIndex
CREATE INDEX "investment_valuations_userId_valuedAt_idx" ON "investment_valuations"("userId", "valuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "investment_valuations_accountId_valuedAt_key" ON "investment_valuations"("accountId", "valuedAt");

-- CreateIndex
CREATE INDEX "investment_documents_userId_createdAt_idx" ON "investment_documents"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "investment_documents_connectionId_providerRef_key" ON "investment_documents"("connectionId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "investment_instruments_symbol_key" ON "investment_instruments"("symbol");

-- CreateIndex
CREATE INDEX "investment_instruments_category_name_idx" ON "investment_instruments"("category", "name");

-- CreateIndex
CREATE INDEX "instrument_price_history_instrumentId_recordedAt_idx" ON "instrument_price_history"("instrumentId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "mutual_fund_schemes_code_key" ON "mutual_fund_schemes"("code");

-- CreateIndex
CREATE INDEX "mutual_fund_schemes_category_amc_idx" ON "mutual_fund_schemes"("category", "amc");

-- CreateIndex
CREATE INDEX "investment_watchlists_userId_createdAt_idx" ON "investment_watchlists"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "investment_watchlist_items_watchlistId_instrumentId_key" ON "investment_watchlist_items"("watchlistId", "instrumentId");

-- CreateIndex
CREATE INDEX "investment_price_alerts_userId_status_idx" ON "investment_price_alerts"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "investment_price_alerts_userId_instrumentId_direction_thres_key" ON "investment_price_alerts"("userId", "instrumentId", "direction", "thresholdMinor");

-- CreateIndex
CREATE INDEX "investment_plans_userId_createdAt_idx" ON "investment_plans"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "sip_tracking_records_userId_status_idx" ON "sip_tracking_records"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sip_tracking_records_userId_schemeCode_providerRef_key" ON "sip_tracking_records"("userId", "schemeCode", "providerRef");

-- CreateIndex
CREATE INDEX "investment_goals_userId_status_idx" ON "investment_goals"("userId", "status");

-- CreateIndex
CREATE INDEX "investment_goal_contributions_goalId_createdAt_idx" ON "investment_goal_contributions"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "fixed_income_assets_userId_category_idx" ON "fixed_income_assets"("userId", "category");

-- CreateIndex
CREATE INDEX "net_worth_snapshots_userId_capturedAt_idx" ON "net_worth_snapshots"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_userId_capturedAt_idx" ON "portfolio_snapshots"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "portfolio_allocation_snapshots_snapshotId_dimension_idx" ON "portfolio_allocation_snapshots"("snapshotId", "dimension");

-- CreateIndex
CREATE INDEX "portfolio_insights_userId_createdAt_idx" ON "portfolio_insights"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "investment_analytics_jobs_status_createdAt_idx" ON "investment_analytics_jobs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "investment_provider_capabilities" ADD CONSTRAINT "investment_provider_capabilities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "investment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_connections" ADD CONSTRAINT "investment_connections_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "investment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_consents" ADD CONSTRAINT "investment_consents_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "investment_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_consent_events" ADD CONSTRAINT "investment_consent_events_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "investment_consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_sync_jobs" ADD CONSTRAINT "investment_sync_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "investment_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_sync_jobs" ADD CONSTRAINT "investment_sync_jobs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "investment_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "investment_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instrument_price_history" ADD CONSTRAINT "instrument_price_history_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "investment_instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_watchlist_items" ADD CONSTRAINT "investment_watchlist_items_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "investment_watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_watchlist_items" ADD CONSTRAINT "investment_watchlist_items_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "investment_instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_goal_contributions" ADD CONSTRAINT "investment_goal_contributions_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "investment_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
