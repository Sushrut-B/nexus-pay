-- CreateEnum
CREATE TYPE "ExternalProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "ExternalAccountType" AS ENUM ('NEXUS_WALLET', 'SAVINGS', 'CURRENT', 'FIXED_DEPOSIT', 'RECURRING_DEPOSIT', 'CREDIT_CARD', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "ExternalConnectionStatus" AS ENUM ('NOT_CONNECTED', 'INITIATING', 'AWAITING_USER_AUTHORIZATION', 'AUTHORIZED', 'SYNC_PENDING', 'ACTIVE', 'PARTIALLY_CONNECTED', 'EXPIRED', 'REVOKED', 'FAILED', 'REQUIRES_ATTENTION');

-- CreateEnum
CREATE TYPE "ExternalConsentStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "ProviderCallbackStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REPLAYED', 'FAILED');

-- CreateEnum
CREATE TYPE "DedupDecision" AS ENUM ('DUPLICATE', 'DISTINCT', 'UNREVIEWED');

-- CreateEnum
CREATE TYPE "InternalTransferStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'EXTERNAL_ACCOUNT_CONNECTED';
ALTER TYPE "NotificationType" ADD VALUE 'EXTERNAL_ACCOUNT_SYNC_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'EXTERNAL_ACCOUNT_CONSENT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'EXTERNAL_ACCOUNT_DISCONNECTED';
ALTER TYPE "NotificationType" ADD VALUE 'INTERNAL_TRANSFER_SUGGESTED';

-- CreateTable
CREATE TABLE "external_financial_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "mode" "ExternalProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "capabilities" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_financial_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_account_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ExternalConnectionStatus" NOT NULL DEFAULT 'INITIATING',
    "providerConnectionRef" VARCHAR(160),
    "callbackStateHash" VARCHAR(64),
    "stateExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_account_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_account_consents" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerConsentRef" VARCHAR(160),
    "status" "ExternalConsentStatus" NOT NULL DEFAULT 'PENDING',
    "purpose" VARCHAR(300) NOT NULL,
    "dataCategories" TEXT[],
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 90,
    "refreshFrequencyMinutes" INTEGER NOT NULL DEFAULT 360,
    "termsVersion" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "external_account_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_financial_accounts" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerAccountRef" VARCHAR(160) NOT NULL,
    "accountType" "ExternalAccountType" NOT NULL,
    "institutionName" VARCHAR(160) NOT NULL,
    "maskedIdentifier" VARCHAR(40) NOT NULL,
    "encryptedAccountRef" VARCHAR(512) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_account_balance_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "reportedBalanceMinor" BIGINT NOT NULL,
    "availableBalanceMinor" BIGINT,
    "currency" VARCHAR(3) NOT NULL,
    "providerReportedAt" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liability" BOOLEAN NOT NULL DEFAULT false,
    "outstandingMinor" BIGINT,
    "availableCreditMinor" BIGINT,
    "statementMinor" BIGINT,
    "minimumDueMinor" BIGINT,
    "paymentDueDate" TIMESTAMP(3),
    "statementPeriodStart" TIMESTAMP(3),
    "statementPeriodEnd" TIMESTAMP(3),

    CONSTRAINT "external_account_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerTxRef" VARCHAR(180) NOT NULL,
    "importId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "merchant" VARCHAR(120),
    "category" VARCHAR(40) NOT NULL,
    "postedAt" TIMESTAMP(3),
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "externalRef" VARCHAR(120),
    "rawPayload" JSONB,
    "dedupDecision" "DedupDecision" NOT NULL DEFAULT 'UNREVIEWED',
    "canonicalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_transaction_imports" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cursor" VARCHAR(500),
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" VARCHAR(500),

    CONSTRAINT "external_transaction_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_deduplication_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canonicalTxId" TEXT NOT NULL,
    "candidateKey" VARCHAR(180) NOT NULL,
    "decision" "DedupDecision" NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_deduplication_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_transfer_matches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "debitTxId" TEXT NOT NULL,
    "creditTxId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "confidence" VARCHAR(20) NOT NULL,
    "status" "InternalTransferStatus" NOT NULL DEFAULT 'SUGGESTED',
    "reason" VARCHAR(300) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_transfer_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_sync_jobs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "account_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_sync_checkpoints" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cursor" VARCHAR(500),
    "lastTransactionAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_callback_events" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "providerRef" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "ProviderCallbackStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_callback_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health_snapshots" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "latencyMs" INTEGER,
    "errorRateBps" INTEGER,
    "details" VARCHAR(500),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_access_audit_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" VARCHAR(30) NOT NULL,
    "actorId" VARCHAR(80) NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(60) NOT NULL,
    "targetId" VARCHAR(120) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_access_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_financial_providers_code_key" ON "external_financial_providers"("code");

-- CreateIndex
CREATE INDEX "external_account_connections_userId_status_idx" ON "external_account_connections"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "external_account_connections_providerId_providerConnectionR_key" ON "external_account_connections"("providerId", "providerConnectionRef");

-- CreateIndex
CREATE INDEX "external_account_consents_userId_status_idx" ON "external_account_consents"("userId", "status");

-- CreateIndex
CREATE INDEX "consent_events_consentId_createdAt_idx" ON "consent_events"("consentId", "createdAt");

-- CreateIndex
CREATE INDEX "external_financial_accounts_userId_accountType_idx" ON "external_financial_accounts"("userId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "external_financial_accounts_connectionId_providerAccountRef_key" ON "external_financial_accounts"("connectionId", "providerAccountRef");

-- CreateIndex
CREATE INDEX "external_account_balance_snapshots_accountId_capturedAt_idx" ON "external_account_balance_snapshots"("accountId", "capturedAt");

-- CreateIndex
CREATE INDEX "external_transactions_userId_transactionAt_idx" ON "external_transactions"("userId", "transactionAt");

-- CreateIndex
CREATE INDEX "external_transactions_category_transactionAt_idx" ON "external_transactions"("category", "transactionAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_transactions_accountId_providerTxRef_key" ON "external_transactions"("accountId", "providerTxRef");

-- CreateIndex
CREATE INDEX "external_transaction_imports_connectionId_startedAt_idx" ON "external_transaction_imports"("connectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_deduplication_records_userId_canonicalTxId_cand_key" ON "transaction_deduplication_records"("userId", "canonicalTxId", "candidateKey");

-- CreateIndex
CREATE INDEX "internal_transfer_matches_userId_status_idx" ON "internal_transfer_matches"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "internal_transfer_matches_userId_debitTxId_creditTxId_key" ON "internal_transfer_matches"("userId", "debitTxId", "creditTxId");

-- CreateIndex
CREATE INDEX "account_sync_jobs_status_nextAttemptAt_idx" ON "account_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "account_sync_checkpoints_connectionId_accountId_key" ON "account_sync_checkpoints"("connectionId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_callback_events_providerId_providerRef_eventType_key" ON "provider_callback_events"("providerId", "providerRef", "eventType");

-- CreateIndex
CREATE INDEX "provider_health_snapshots_providerId_capturedAt_idx" ON "provider_health_snapshots"("providerId", "capturedAt");

-- CreateIndex
CREATE INDEX "data_access_audit_events_userId_createdAt_idx" ON "data_access_audit_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "external_account_connections" ADD CONSTRAINT "external_account_connections_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "external_financial_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_account_consents" ADD CONSTRAINT "external_account_consents_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "external_account_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "external_account_consents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_financial_accounts" ADD CONSTRAINT "external_financial_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "external_account_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_account_balance_snapshots" ADD CONSTRAINT "external_account_balance_snapshots_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "external_financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_transactions" ADD CONSTRAINT "external_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "external_financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_sync_jobs" ADD CONSTRAINT "account_sync_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "external_account_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_sync_checkpoints" ADD CONSTRAINT "account_sync_checkpoints_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "external_account_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_sync_checkpoints" ADD CONSTRAINT "account_sync_checkpoints_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "external_financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_callback_events" ADD CONSTRAINT "provider_callback_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "external_financial_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_health_snapshots" ADD CONSTRAINT "provider_health_snapshots_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "external_financial_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
