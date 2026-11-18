-- CreateEnum
CREATE TYPE "RewardEntryType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'REVERSE', 'ADJUST', 'BONUS');

-- CreateEnum
CREATE TYPE "RewardActivityType" AS ENUM ('POINTS_EARNED', 'POINTS_REDEEMED', 'POINTS_EXPIRED', 'POINTS_REVERSED', 'CASHBACK_PENDING', 'CASHBACK_CREDITED', 'CASHBACK_FAILED', 'PROMO_DISCOUNT', 'REFERRAL_REWARD', 'CAMPAIGN_BONUS', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardCampaignType" AS ENUM ('POINTS_MULTIPLIER', 'CASHBACK', 'FIXED_DISCOUNT', 'PERCENTAGE_DISCOUNT', 'BONUS_POINTS', 'REFERRAL_BONUS', 'FIRST_TRANSACTION', 'MERCHANT_SPECIFIC', 'LIMITED_TIME_OFFER');

-- CreateEnum
CREATE TYPE "RewardCampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashbackStatus" AS ENUM ('ELIGIBILITY_PENDING', 'ELIGIBLE', 'PENDING_CREDIT', 'PROCESSING', 'CREDITED', 'FAILED', 'REQUIRES_RECONCILIATION', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RewardRedemptionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'VOID');

-- CreateEnum
CREATE TYPE "PromoCodeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RewardInvestigationStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReferralRewardStatus" AS ENUM ('PENDING', 'QUALIFIED', 'ISSUED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REWARD_POINTS_EARNED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_POINTS_REDEEMED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_POINTS_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_CASHBACK_PENDING';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_CASHBACK_CREDITED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_CASHBACK_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_CAMPAIGN_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_OFFER_AVAILABLE';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_TIER_UPGRADED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_TIER_DOWNGRADED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_REFERRAL_QUALIFIED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_REFERRAL_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_PROMO_APPLIED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_REDEMPTION_CONFIRMED';

-- CreateTable
CREATE TABLE "reward_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "availablePoints" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarnedPoints" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemedPoints" INTEGER NOT NULL DEFAULT 0,
    "pendingPoints" INTEGER NOT NULL DEFAULT 0,
    "tierId" TEXT,
    "qualifyingSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "qualifyingTxCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "RewardEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" VARCHAR(40) NOT NULL,
    "referenceId" VARCHAR(120) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "merchantId" TEXT,
    "campaignId" TEXT,
    "transactionRef" VARCHAR(80),
    "expiresAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RewardActivityType" NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "points" INTEGER,
    "amountMinor" INTEGER,
    "currency" VARCHAR(3),
    "merchantId" TEXT,
    "merchantName" VARCHAR(120),
    "campaignId" TEXT,
    "transactionRef" VARCHAR(80),
    "referenceId" VARCHAR(120) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_expiry_policies" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "fixedDate" TIMESTAMP(3),
    "relativeDays" INTEGER NOT NULL DEFAULT 0,
    "campaignId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_expiry_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_catalogue_items" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "discountMinor" INTEGER,
    "discountBps" INTEGER,
    "quantityTotal" INTEGER,
    "quantityRedeemed" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "terms" VARCHAR(1000),
    "imageUrl" VARCHAR(2048),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_catalogue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_redemptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "catalogueItemId" TEXT NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "status" "RewardRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_vouchers" (
    "id" TEXT NOT NULL,
    "redemptionId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "codeHint" VARCHAR(24) NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_campaigns" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "ownerType" VARCHAR(20) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "type" "RewardCampaignType" NOT NULL,
    "status" "RewardCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "minSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "maxRewardMinor" INTEGER NOT NULL DEFAULT 0,
    "pointsPerMinor" INTEGER NOT NULL DEFAULT 0,
    "cashbackBps" INTEGER NOT NULL DEFAULT 0,
    "bonusPoints" INTEGER NOT NULL DEFAULT 0,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "budgetMinor" INTEGER NOT NULL DEFAULT 0,
    "pointsBudget" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "globalRedemptionLimit" INTEGER,
    "eligibleCategories" TEXT[],
    "customerSegments" TEXT[],
    "promoCode" VARCHAR(60),
    "eligibilityRules" JSONB,
    "terms" VARCHAR(2000),
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_eligibility_rules" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "value" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_eligibility_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_merchants" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,

    CONSTRAINT "campaign_merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_budgets" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "allocatedMinor" INTEGER NOT NULL DEFAULT 0,
    "reservedMinor" INTEGER NOT NULL DEFAULT 0,
    "consumedMinor" INTEGER NOT NULL DEFAULT 0,
    "pointsAllocated" INTEGER NOT NULL DEFAULT 0,
    "pointsReserved" INTEGER NOT NULL DEFAULT 0,
    "pointsConsumed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_budget_reservations" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "referenceType" VARCHAR(40) NOT NULL,
    "referenceId" VARCHAR(120) NOT NULL,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_budget_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_entitlements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "transactionRef" VARCHAR(80) NOT NULL,
    "merchantId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "CashbackStatus" NOT NULL DEFAULT 'ELIGIBILITY_PENDING',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "fundingOperationId" TEXT,
    "paymentRef" VARCHAR(80),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" VARCHAR(80),
    "failureCategory" VARCHAR(60),
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "cashback_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_processing_attempts" (
    "id" TEXT NOT NULL,
    "entitlementId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "error" VARCHAR(500),
    "paymentRef" VARCHAR(80),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashback_processing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentRef" VARCHAR(80),
    "discountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_tiers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "rank" INTEGER NOT NULL,
    "minSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "minTransactions" INTEGER NOT NULL DEFAULT 0,
    "minLifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "pointsMultiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "benefits" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_loyalty_statuses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "qualifyingSpendMinor" INTEGER NOT NULL DEFAULT 0,
    "qualifyingTxCount" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_loyalty_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_tier_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromTierId" TEXT,
    "toTierId" TEXT NOT NULL,
    "direction" VARCHAR(20) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "qualificationData" JSONB NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_tier_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attributions" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "referredUserId" TEXT NOT NULL,
    "referredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(40) NOT NULL,

    CONSTRAINT "referral_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_qualifications" (
    "id" TEXT NOT NULL,
    "attributionId" TEXT NOT NULL,
    "qualificationType" VARCHAR(40) NOT NULL,
    "transactionRef" VARCHAR(80),
    "qualifiedAt" TIMESTAMP(3),
    "status" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_rewards" (
    "id" TEXT NOT NULL,
    "attributionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "cashbackMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "ReferralRewardStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_risk_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "relatedUserId" TEXT,
    "campaignId" TEXT,
    "transactionRef" VARCHAR(80),
    "redemptionId" TEXT,
    "severity" "RiskSeverity" NOT NULL,
    "reasonCode" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" "RewardInvestigationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(1000),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_investigations" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "subjectId" VARCHAR(120) NOT NULL,
    "riskEventId" TEXT,
    "status" "RewardInvestigationStatus" NOT NULL DEFAULT 'OPEN',
    "notes" VARCHAR(2000),
    "assignedTo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "reward_investigations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_notification_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" VARCHAR(60) NOT NULL,
    "eventKey" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_accounts_userId_key" ON "reward_accounts"("userId");

-- CreateIndex
CREATE INDEX "reward_accounts_tierId_idx" ON "reward_accounts"("tierId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_ledger_entries_idempotencyKey_key" ON "reward_ledger_entries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "reward_ledger_entries_userId_createdAt_idx" ON "reward_ledger_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reward_ledger_entries_expiresAt_idx" ON "reward_ledger_entries"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_ledger_entries_referenceType_referenceId_type_key" ON "reward_ledger_entries"("referenceType", "referenceId", "type");

-- CreateIndex
CREATE INDEX "reward_activities_userId_createdAt_idx" ON "reward_activities"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_activities_type_referenceId_key" ON "reward_activities"("type", "referenceId");

-- CreateIndex
CREATE INDEX "reward_expiry_policies_campaignId_isActive_idx" ON "reward_expiry_policies"("campaignId", "isActive");

-- CreateIndex
CREATE INDEX "reward_catalogue_items_isActive_expiresAt_idx" ON "reward_catalogue_items"("isActive", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_redemptions_reference_key" ON "reward_redemptions"("reference");

-- CreateIndex
CREATE INDEX "reward_redemptions_userId_createdAt_idx" ON "reward_redemptions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_vouchers_redemptionId_key" ON "reward_vouchers"("redemptionId");

-- CreateIndex
CREATE UNIQUE INDEX "reward_vouchers_tokenHash_key" ON "reward_vouchers"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "reward_campaigns_promoCode_key" ON "reward_campaigns"("promoCode");

-- CreateIndex
CREATE INDEX "reward_campaigns_merchantId_status_idx" ON "reward_campaigns"("merchantId", "status");

-- CreateIndex
CREATE INDEX "reward_campaigns_status_startAt_endAt_idx" ON "reward_campaigns"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "campaign_eligibility_rules_campaignId_isActive_idx" ON "campaign_eligibility_rules"("campaignId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_merchants_campaignId_merchantId_key" ON "campaign_merchants"("campaignId", "merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_budgets_campaignId_key" ON "campaign_budgets"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_budget_reservations_status_expiresAt_idx" ON "campaign_budget_reservations"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_budget_reservations_campaignId_referenceType_refer_key" ON "campaign_budget_reservations"("campaignId", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "cashback_entitlements_idempotencyKey_key" ON "cashback_entitlements"("idempotencyKey");

-- CreateIndex
CREATE INDEX "cashback_entitlements_status_nextAttemptAt_idx" ON "cashback_entitlements"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "cashback_entitlements_userId_campaignId_transactionRef_key" ON "cashback_entitlements"("userId", "campaignId", "transactionRef");

-- CreateIndex
CREATE INDEX "cashback_processing_attempts_entitlementId_attempt_idx" ON "cashback_processing_attempts"("entitlementId", "attempt");

-- CreateIndex
CREATE INDEX "promo_code_redemptions_userId_createdAt_idx" ON "promo_code_redemptions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_redemptions_promoCodeId_paymentRef_key" ON "promo_code_redemptions"("promoCodeId", "paymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tiers_name_key" ON "loyalty_tiers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_tiers_rank_key" ON "loyalty_tiers"("rank");

-- CreateIndex
CREATE UNIQUE INDEX "user_loyalty_statuses_userId_key" ON "user_loyalty_statuses"("userId");

-- CreateIndex
CREATE INDEX "loyalty_tier_history_userId_createdAt_idx" ON "loyalty_tier_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_userId_key" ON "referral_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attributions_referredUserId_key" ON "referral_attributions"("referredUserId");

-- CreateIndex
CREATE INDEX "referral_attributions_codeId_idx" ON "referral_attributions"("codeId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_qualifications_attributionId_qualificationType_key" ON "referral_qualifications"("attributionId", "qualificationType");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_idempotencyKey_key" ON "referral_rewards"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "referral_rewards_attributionId_userId_type_key" ON "referral_rewards"("attributionId", "userId", "type");

-- CreateIndex
CREATE INDEX "reward_risk_events_status_createdAt_idx" ON "reward_risk_events"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reward_investigations_status_createdAt_idx" ON "reward_investigations"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reward_notification_events_eventKey_key" ON "reward_notification_events"("eventKey");

-- CreateIndex
CREATE INDEX "reward_notification_events_userId_createdAt_idx" ON "reward_notification_events"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "reward_accounts" ADD CONSTRAINT "reward_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
