-- CreateEnum
CREATE TYPE "LendingProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CreditProductType" AS ENUM ('PERSONAL', 'CONSUMER_DURABLE', 'EDUCATION', 'VEHICLE', 'BUSINESS', 'SECURED', 'CREDIT_LINE', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestRateType" AS ENUM ('REDUCING_BALANCE', 'FLAT', 'VARIABLE', 'PROVIDER_DEFINED');

-- CreateEnum
CREATE TYPE "LoanApplicationStatus" AS ENUM ('DRAFT', 'READY_FOR_SUBMISSION', 'SUBMITTED', 'ACKNOWLEDGED', 'UNDER_REVIEW', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED', 'OFFERED', 'ACCEPTED', 'DISBURSEMENT_PENDING', 'DISBURSED', 'WITHDRAWN', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EligibilityOutcome" AS ENUM ('PRE_ASSESSMENT_ONLY', 'PROVIDER_ELIGIBLE', 'PROVIDER_INELIGIBLE', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "LoanDocumentStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'CLOSED', 'REQUIRES_RECONCILIATION');

-- CreateEnum
CREATE TYPE "LoanRepaymentStatus" AS ENUM ('UPCOMING', 'DUE', 'PROCESSING', 'PAID', 'OVERDUE', 'FAILED', 'WAIVED', 'UNKNOWN', 'REQUIRES_RECONCILIATION');

-- CreateEnum
CREATE TYPE "LenderEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'REPLAYED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_APPLICATION_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_ADDITIONAL_INFORMATION_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_OFFER_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_REPAYMENT_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_REPAYMENT_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'CREDIT_LOAN_DISBURSED';

-- CreateTable
CREATE TABLE "lending_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" "LendingProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "capabilities" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lending_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lending_provider_capabilities" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lending_provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_products" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "type" "CreditProductType" NOT NULL,
    "minAmountMinor" INTEGER NOT NULL,
    "maxAmountMinor" INTEGER NOT NULL,
    "interestRateBps" INTEGER NOT NULL,
    "interestRateType" "InterestRateType" NOT NULL DEFAULT 'REDUCING_BALANCE',
    "aprBps" INTEGER,
    "minTenureMonths" INTEGER NOT NULL,
    "maxTenureMonths" INTEGER NOT NULL,
    "processingFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "processingFeeBps" INTEGER NOT NULL DEFAULT 0,
    "otherChargesMinor" INTEGER NOT NULL DEFAULT 0,
    "repaymentFrequency" VARCHAR(30) NOT NULL DEFAULT 'MONTHLY',
    "eligibilityCriteria" JSONB,
    "prepaymentTerms" VARCHAR(1000),
    "latePaymentTerms" VARCHAR(1000),
    "requiredDocuments" TEXT[],
    "terms" VARCHAR(3000),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_offers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerOfferRef" VARCHAR(160) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "interestRateBps" INTEGER NOT NULL,
    "aprBps" INTEGER,
    "tenureMonths" INTEGER NOT NULL,
    "emiMinor" INTEGER,
    "totalRepaymentMinor" INTEGER,
    "totalInterestMinor" INTEGER,
    "feesMinor" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "terms" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eligibility_assessments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "outcome" "EligibilityOutcome" NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "answers" JSONB NOT NULL,
    "observedData" JSONB,
    "result" JSONB NOT NULL,
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eligibility_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "LoanApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "providerApplicationRef" VARCHAR(160),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applicant_information" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "employmentCategory" VARCHAR(40) NOT NULL,
    "monthlyIncomeRange" VARCHAR(40) NOT NULL,
    "employmentMonths" INTEGER NOT NULL,
    "existingObligationsMinor" INTEGER NOT NULL DEFAULT 0,
    "requestedAmountMinor" INTEGER NOT NULL,
    "requestedTenureMonths" INTEGER NOT NULL,
    "purpose" VARCHAR(120) NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_applicant_information_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_application_status_history" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "fromStatus" "LoanApplicationStatus",
    "toStatus" "LoanApplicationStatus" NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "reason" VARCHAR(500),
    "evidence" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_consents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" VARCHAR(300) NOT NULL,
    "disclosures" JSONB NOT NULL,
    "dataShared" JSONB NOT NULL,
    "consentVersion" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "loan_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_documents" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "encryptedStorage" VARCHAR(1024) NOT NULL,
    "status" "LoanDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "scanStatus" VARCHAR(30) NOT NULL DEFAULT 'NOT_AVAILABLE',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "loan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_loans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "providerLoanRef" VARCHAR(160) NOT NULL,
    "originalPrincipalMinor" INTEGER NOT NULL,
    "outstandingPrincipalMinor" INTEGER NOT NULL,
    "interestRateBps" INTEGER NOT NULL,
    "aprBps" INTEGER,
    "tenureMonths" INTEGER NOT NULL,
    "emiMinor" INTEGER NOT NULL,
    "nextDueDate" TIMESTAMP(3),
    "totalRepaidMinor" INTEGER NOT NULL DEFAULT 0,
    "totalRemainingMinor" INTEGER NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "providerReportedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_schedules" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNo" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalMinor" INTEGER NOT NULL,
    "interestMinor" INTEGER NOT NULL,
    "feesMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "status" "LoanRepaymentStatus" NOT NULL DEFAULT 'UPCOMING',
    "paymentRef" VARCHAR(120),
    "providerRef" VARCHAR(160) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentRef" VARCHAR(120),
    "providerRef" VARCHAR(160) NOT NULL,
    "status" "LoanRepaymentStatus" NOT NULL DEFAULT 'PAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_servicing_events" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "applicationId" TEXT,
    "loanId" TEXT,
    "eventType" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "providerRef" VARCHAR(160),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_servicing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_webhook_events" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "providerEventId" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "LenderEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processedAt" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lender_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_sync_jobs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrowing_overview_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeLoans" INTEGER NOT NULL DEFAULT 0,
    "outstandingMinor" INTEGER NOT NULL DEFAULT 0,
    "monthlyCommitmentMinor" INTEGER NOT NULL DEFAULT 0,
    "upcomingMinor" INTEGER NOT NULL DEFAULT 0,
    "completedLoans" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "borrowing_overview_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_affordability_scenarios" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "interestRateBps" INTEGER NOT NULL,
    "emiMinor" INTEGER NOT NULL,
    "currentInflowMinor" INTEGER NOT NULL,
    "currentOutflowMinor" INTEGER NOT NULL,
    "commitmentsMinor" INTEGER NOT NULL,
    "remainingMinor" INTEGER NOT NULL,
    "assumptions" JSONB NOT NULL,
    "dataCoverageBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_affordability_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lending_providers_code_key" ON "lending_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "lending_provider_capabilities_providerId_capability_key" ON "lending_provider_capabilities"("providerId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "credit_products_code_key" ON "credit_products"("code");

-- CreateIndex
CREATE INDEX "credit_products_providerId_status_idx" ON "credit_products"("providerId", "status");

-- CreateIndex
CREATE INDEX "credit_offers_status_expiresAt_idx" ON "credit_offers"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "credit_offers_providerId_providerOfferRef_key" ON "credit_offers"("providerId", "providerOfferRef");

-- CreateIndex
CREATE INDEX "eligibility_assessments_userId_createdAt_idx" ON "eligibility_assessments"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applications_idempotencyKey_key" ON "loan_applications"("idempotencyKey");

-- CreateIndex
CREATE INDEX "loan_applications_userId_createdAt_idx" ON "loan_applications"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applications_providerId_providerApplicationRef_key" ON "loan_applications"("providerId", "providerApplicationRef");

-- CreateIndex
CREATE UNIQUE INDEX "loan_applicant_information_applicationId_key" ON "loan_applicant_information"("applicationId");

-- CreateIndex
CREATE INDEX "loan_application_status_history_applicationId_createdAt_idx" ON "loan_application_status_history"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "loan_documents_userId_status_idx" ON "loan_documents"("userId", "status");

-- CreateIndex
CREATE INDEX "active_loans_userId_status_idx" ON "active_loans"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "active_loans_providerId_providerLoanRef_key" ON "active_loans"("providerId", "providerLoanRef");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_schedules_loanId_providerRef_key" ON "loan_repayment_schedules"("loanId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_schedules_loanId_installmentNo_key" ON "loan_repayment_schedules"("loanId", "installmentNo");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayments_providerRef_key" ON "loan_repayments"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "lender_webhook_events_providerId_providerEventId_key" ON "lender_webhook_events"("providerId", "providerEventId");

-- CreateIndex
CREATE INDEX "provider_sync_jobs_status_nextAttemptAt_idx" ON "provider_sync_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "borrowing_overview_snapshots_userId_key" ON "borrowing_overview_snapshots"("userId");

-- CreateIndex
CREATE INDEX "loan_affordability_scenarios_userId_createdAt_idx" ON "loan_affordability_scenarios"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "lending_provider_capabilities" ADD CONSTRAINT "lending_provider_capabilities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_products" ADD CONSTRAINT "credit_products_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_offers" ADD CONSTRAINT "credit_offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "credit_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_offers" ADD CONSTRAINT "credit_offers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applicant_information" ADD CONSTRAINT "loan_applicant_information_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_application_status_history" ADD CONSTRAINT "loan_application_status_history_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_consents" ADD CONSTRAINT "loan_consents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_documents" ADD CONSTRAINT "loan_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_loans" ADD CONSTRAINT "active_loans_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_schedules" ADD CONSTRAINT "loan_repayment_schedules_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "active_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "active_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_servicing_events" ADD CONSTRAINT "loan_servicing_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_servicing_events" ADD CONSTRAINT "loan_servicing_events_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "loan_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_servicing_events" ADD CONSTRAINT "loan_servicing_events_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "active_loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_webhook_events" ADD CONSTRAINT "lender_webhook_events_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_sync_jobs" ADD CONSTRAINT "provider_sync_jobs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "lending_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
