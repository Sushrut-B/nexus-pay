-- CreateEnum
CREATE TYPE "InsuranceProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "InsuranceProductCategory" AS ENUM ('HEALTH', 'LIFE', 'TERM_LIFE', 'MOTOR', 'TWO_WHEELER', 'CAR', 'TRAVEL', 'PERSONAL_ACCIDENT', 'HOME', 'OTHER');

-- CreateEnum
CREATE TYPE "InsuranceQuoteStatus" AS ENUM ('DRAFT', 'INPUT_REQUIRED', 'SUBMITTED', 'PROCESSING', 'QUOTE_AVAILABLE', 'QUOTE_EXPIRED', 'REJECTED', 'FAILED', 'REQUIRES_CUSTOMER_ACTION');

-- CreateEnum
CREATE TYPE "InsuranceApplicationStatus" AS ENUM ('DRAFT', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'POLICY_ISSUANCE_PENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "InsurancePolicyStatus" AS ENUM ('PENDING_ISSUANCE', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'LAPSED', 'CANCELLED', 'SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InsurancePremiumStatus" AS ENUM ('UPCOMING', 'DUE', 'PAYMENT_PENDING', 'PAID', 'OVERDUE', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InsuranceClaimStatus" AS ENUM ('DRAFT', 'DOCUMENTS_REQUIRED', 'READY_TO_SUBMIT', 'SUBMITTED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'SETTLEMENT_PENDING', 'SETTLED', 'CLOSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InsuranceDocumentStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "InsuranceEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REPLAYED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_QUOTE_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_QUOTE_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_APPLICATION_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_APPLICATION_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_DOCUMENTS_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_POLICY_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_POLICY_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_PREMIUM_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_RENEWAL_APPROACHING';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_POLICY_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_CLAIM_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_CLAIM_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_CLAIM_ADDITIONAL_INFO';
ALTER TYPE "NotificationType" ADD VALUE 'INSURANCE_CLAIM_COMPLETED';

-- CreateTable
CREATE TABLE "insurance_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" "InsuranceProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "status" VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
    "capabilities" JSONB NOT NULL,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_provider_capabilities" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "insurance_provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_products" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "category" "InsuranceProductCategory" NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "coverageSummary" VARCHAR(1000),
    "coverageMinor" INTEGER,
    "premiumMinor" INTEGER,
    "premiumFrequency" VARCHAR(30) NOT NULL DEFAULT 'MONTHLY',
    "durationMonths" INTEGER,
    "benefits" JSONB,
    "exclusions" JSONB,
    "waitingPeriods" JSONB,
    "eligibility" JSONB,
    "deductibles" JSONB,
    "addons" JSONB,
    "claimProcess" VARCHAR(2000),
    "renewalTerms" VARCHAR(2000),
    "officialDocs" JSONB,
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_product_versions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "details" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_product_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_product_documents" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "documentType" VARCHAR(40) NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_product_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_quotes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "InsuranceQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "providerRef" VARCHAR(160),
    "answers" JSONB NOT NULL,
    "premiumMinor" INTEGER,
    "premiumBreakdown" JSONB,
    "coverageMinor" INTEGER,
    "validUntil" TIMESTAMP(3),
    "providerMetadata" JSONB,
    "rawSnapshot" JSONB,
    "consentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_quote_snapshots" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_quote_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quoteId" TEXT,
    "providerId" TEXT NOT NULL,
    "status" "InsuranceApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "providerRef" VARCHAR(160),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "applicantData" JSONB NOT NULL,
    "consentId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "providerId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "policyNumberMasked" VARCHAR(60) NOT NULL,
    "category" "InsuranceProductCategory" NOT NULL,
    "coverageMinor" INTEGER NOT NULL,
    "premiumMinor" INTEGER NOT NULL,
    "premiumFrequency" VARCHAR(30) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "renewalDate" TIMESTAMP(3),
    "status" "InsurancePolicyStatus" NOT NULL DEFAULT 'PENDING_ISSUANCE',
    "nominee" JSONB,
    "providerContact" JSONB,
    "providerReportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_premium_schedules" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "InsurancePremiumStatus" NOT NULL DEFAULT 'UPCOMING',
    "providerRef" VARCHAR(160) NOT NULL,
    "providerPaymentRef" VARCHAR(160),
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "paymentInstructions" VARCHAR(1000),
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_premium_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_premium_payments" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentRef" VARCHAR(120),
    "providerRef" VARCHAR(160) NOT NULL,
    "status" "InsurancePremiumStatus" NOT NULL DEFAULT 'PAID',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_premium_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_renewals" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "quoteRef" VARCHAR(160),
    "documentRef" VARCHAR(160),
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "claimType" VARCHAR(80) NOT NULL,
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "status" "InsuranceClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "requestedDocuments" JSONB,
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerContact" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claim_status_history" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "fromStatus" "InsuranceClaimStatus",
    "toStatus" "InsuranceClaimStatus" NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "evidence" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_claim_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ownerType" VARCHAR(30) NOT NULL,
    "ownerId" VARCHAR(80) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "encryptedStorage" VARCHAR(1024) NOT NULL,
    "status" "InsuranceDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "scanStatus" VARCHAR(30) NOT NULL DEFAULT 'NOT_AVAILABLE',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "insurance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_consents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "purpose" VARCHAR(300) NOT NULL,
    "dataCategories" TEXT[],
    "sharedFields" JSONB NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "insurance_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_provider_webhooks" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "eventId" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "InsuranceEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_provider_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_provider_syncs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_provider_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500),
    "reference" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quoteNotifications" BOOLEAN NOT NULL DEFAULT true,
    "applicationNotifications" BOOLEAN NOT NULL DEFAULT true,
    "policyNotifications" BOOLEAN NOT NULL DEFAULT true,
    "premiumReminders" BOOLEAN NOT NULL DEFAULT true,
    "renewalReminders" BOOLEAN NOT NULL DEFAULT true,
    "claimNotifications" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurance_providers_code_key" ON "insurance_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_provider_capabilities_providerId_capability_key" ON "insurance_provider_capabilities"("providerId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_products_code_key" ON "insurance_products"("code");

-- CreateIndex
CREATE INDEX "insurance_products_providerId_category_status_idx" ON "insurance_products"("providerId", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_product_versions_productId_version_key" ON "insurance_product_versions"("productId", "version");

-- CreateIndex
CREATE INDEX "insurance_quotes_userId_createdAt_idx" ON "insurance_quotes"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_quotes_providerId_providerRef_key" ON "insurance_quotes"("providerId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_applications_idempotencyKey_key" ON "insurance_applications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "insurance_applications_userId_createdAt_idx" ON "insurance_applications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_applications_providerId_providerRef_key" ON "insurance_applications"("providerId", "providerRef");

-- CreateIndex
CREATE INDEX "insurance_policies_userId_status_idx" ON "insurance_policies"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_providerId_providerRef_key" ON "insurance_policies"("providerId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_premium_schedules_policyId_installmentNo_key" ON "insurance_premium_schedules"("policyId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_premium_schedules_policyId_providerRef_key" ON "insurance_premium_schedules"("policyId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_premium_payments_providerRef_key" ON "insurance_premium_payments"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_premium_payments_idempotencyKey_key" ON "insurance_premium_payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_renewals_policyId_providerRef_key" ON "insurance_renewals"("policyId", "providerRef");

-- CreateIndex
CREATE INDEX "insurance_claims_userId_status_idx" ON "insurance_claims"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_providerId_providerRef_key" ON "insurance_claims"("providerId", "providerRef");

-- CreateIndex
CREATE INDEX "insurance_claim_status_history_claimId_createdAt_idx" ON "insurance_claim_status_history"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "insurance_documents_userId_ownerType_ownerId_idx" ON "insurance_documents"("userId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "insurance_consents_userId_status_idx" ON "insurance_consents"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_provider_webhooks_providerId_eventId_key" ON "insurance_provider_webhooks"("providerId", "eventId");

-- CreateIndex
CREATE INDEX "insurance_provider_syncs_status_nextAttemptAt_idx" ON "insurance_provider_syncs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "insurance_activities_userId_createdAt_idx" ON "insurance_activities"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_notification_preferences_userId_key" ON "insurance_notification_preferences"("userId");

-- AddForeignKey
ALTER TABLE "insurance_provider_capabilities" ADD CONSTRAINT "insurance_provider_capabilities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "insurance_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_products" ADD CONSTRAINT "insurance_products_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "insurance_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_product_versions" ADD CONSTRAINT "insurance_product_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "insurance_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_product_documents" ADD CONSTRAINT "insurance_product_documents_productId_fkey" FOREIGN KEY ("productId") REFERENCES "insurance_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "insurance_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_quote_snapshots" ADD CONSTRAINT "insurance_quote_snapshots_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "insurance_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_applications" ADD CONSTRAINT "insurance_applications_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "insurance_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "insurance_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_premium_schedules" ADD CONSTRAINT "insurance_premium_schedules_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_premium_payments" ADD CONSTRAINT "insurance_premium_payments_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_renewals" ADD CONSTRAINT "insurance_renewals_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claim_status_history" ADD CONSTRAINT "insurance_claim_status_history_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "insurance_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_provider_webhooks" ADD CONSTRAINT "insurance_provider_webhooks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "insurance_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_provider_syncs" ADD CONSTRAINT "insurance_provider_syncs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "insurance_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
