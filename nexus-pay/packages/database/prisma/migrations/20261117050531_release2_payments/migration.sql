-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PROCESSING', 'SETTLED', 'REJECTED', 'UNKNOWN', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "FundingOperationStatus" AS ENUM ('CREATED', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNKNOWN', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('P2P', 'FUNDING');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('SENT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PROCESSING', 'SUCCESSFUL', 'FAILED', 'RECONCILIATION_REQUIRED');

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "clientRequestId" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "recipientUsername" VARCHAR(30) NOT NULL,
    "recipientDisplayName" VARCHAR(60) NOT NULL,
    "sourceAccountId" VARCHAR(80) NOT NULL,
    "destinationAccountId" VARCHAR(80) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" VARCHAR(140),
    "paymentRef" VARCHAR(80),
    "raftLogIndex" BIGINT,
    "rejectionCode" VARCHAR(80),
    "failureMessage" VARCHAR(500),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "receiptVerifiedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_operations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "clientRequestId" VARCHAR(64) NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "status" "FundingOperationStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "raftlineAccountId" VARCHAR(80) NOT NULL,
    "fundingRef" VARCHAR(80),
    "balanceAfterMinor" BIGINT,
    "failureCode" VARCHAR(80),
    "failureMessage" VARCHAR(500),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "receiptVerifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funding_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_records" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "kind" "TransactionKind" NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "status" "TransactionStatus" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "counterpartyName" VARCHAR(80),
    "counterpartyUsername" VARCHAR(30),
    "paymentRef" VARCHAR(80),
    "idempotencyKey" VARCHAR(80),
    "description" VARCHAR(200),
    "balanceAfterMinor" BIGINT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paymentIntentId" TEXT,
    "fundingOperationId" TEXT,

    CONSTRAINT "transaction_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotencyKey_key" ON "payment_intents"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_paymentRef_key" ON "payment_intents"("paymentRef");

-- CreateIndex
CREATE INDEX "payment_intents_userId_createdAt_idx" ON "payment_intents"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_recipientUserId_createdAt_idx" ON "payment_intents"("recipientUserId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_intents_status_lastAttemptAt_idx" ON "payment_intents"("status", "lastAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_userId_clientRequestId_key" ON "payment_intents"("userId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "funding_operations_idempotencyKey_key" ON "funding_operations"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "funding_operations_fundingRef_key" ON "funding_operations"("fundingRef");

-- CreateIndex
CREATE INDEX "funding_operations_userId_createdAt_idx" ON "funding_operations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "funding_operations_status_lastAttemptAt_idx" ON "funding_operations"("status", "lastAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "funding_operations_userId_clientRequestId_key" ON "funding_operations"("userId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_paymentIntentId_key" ON "transaction_records"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_fundingOperationId_key" ON "transaction_records"("fundingOperationId");

-- CreateIndex
CREATE INDEX "transaction_records_userId_occurredAt_idx" ON "transaction_records"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "transaction_records_userId_direction_status_idx" ON "transaction_records"("userId", "direction", "status");

-- CreateIndex
CREATE INDEX "transaction_records_userId_kind_status_idx" ON "transaction_records"("userId", "kind", "status");

-- CreateIndex
CREATE INDEX "transaction_records_status_idx" ON "transaction_records"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_userId_paymentRef_key" ON "transaction_records"("userId", "paymentRef");

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_operations" ADD CONSTRAINT "funding_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_operations" ADD CONSTRAINT "funding_operations_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_fundingOperationId_fkey" FOREIGN KEY ("fundingOperationId") REFERENCES "funding_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
