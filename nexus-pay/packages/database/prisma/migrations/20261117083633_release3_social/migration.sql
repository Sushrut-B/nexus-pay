-- CreateEnum
CREATE TYPE "PaymentRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'PAID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "GroupRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "GroupCategory" AS ENUM ('HOME', 'TRAVEL', 'FOOD', 'FRIENDS', 'FAMILY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FOOD', 'TRAVEL', 'ACCOMMODATION', 'SHOPPING', 'TRANSPORT', 'ENTERTAINMENT', 'UTILITIES', 'OTHER');

-- CreateEnum
CREATE TYPE "SplitMethod" AS ENUM ('EQUAL', 'CUSTOM', 'PERCENTAGE', 'SHARES');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT_REQUEST_RECEIVED', 'PAYMENT_REQUEST_ACCEPTED', 'PAYMENT_REQUEST_DECLINED', 'PAYMENT_REQUEST_PAID', 'ADDED_TO_GROUP', 'GROUP_EXPENSE_CREATED', 'GROUP_EXPENSE_UPDATED', 'SETTLEMENT_COMPLETED', 'SETTLEMENT_FAILED');

-- CreateEnum
CREATE TYPE "GroupActivityEventType" AS ENUM ('GROUP_CREATED', 'GROUP_UPDATED', 'MEMBER_JOINED', 'MEMBER_REMOVED', 'EXPENSE_CREATED', 'EXPENSE_UPDATED', 'EXPENSE_DELETED', 'SETTLEMENT_RECORDED', 'SETTLEMENT_COMPLETED', 'SETTLEMENT_FAILED');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "contactUserId" TEXT NOT NULL,
    "displayLabel" VARCHAR(60),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "description" VARCHAR(200),
    "dueAt" TIMESTAMP(3),
    "status" "PaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "paymentRef" VARCHAR(80),
    "groupId" TEXT,
    "expenseId" TEXT,
    "clientRequestId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_groups" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(400),
    "category" "GroupCategory" NOT NULL DEFAULT 'OTHER',
    "imageUrl" VARCHAR(2048),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "expense_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GroupRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(400),
    "totalAmountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paidByUserId" TEXT NOT NULL,
    "splitMethod" "SplitMethod" NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_splits" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareAmountMinor" BIGINT NOT NULL,
    "percentage" INTEGER,
    "shares" INTEGER,

    CONSTRAINT "expense_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_settlements" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "payeeUserId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "paymentRef" VARCHAR(80),
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "clientRequestId" VARCHAR(64) NOT NULL,
    "paymentIntentId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "group_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_activities" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" "GroupActivityEventType" NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(64) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" VARCHAR(400),
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_ownerUserId_createdAt_idx" ON "contacts"("ownerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_ownerUserId_contactUserId_key" ON "contacts"("ownerUserId", "contactUserId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_paymentRef_key" ON "payment_requests"("paymentRef");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_clientRequestId_key" ON "payment_requests"("clientRequestId");

-- CreateIndex
CREATE INDEX "payment_requests_payerUserId_status_createdAt_idx" ON "payment_requests"("payerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_requests_requesterUserId_status_createdAt_idx" ON "payment_requests"("requesterUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_requests_groupId_idx" ON "payment_requests"("groupId");

-- CreateIndex
CREATE INDEX "expense_groups_createdAt_idx" ON "expense_groups"("createdAt");

-- CreateIndex
CREATE INDEX "group_members_userId_removedAt_idx" ON "group_members"("userId", "removedAt");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_groupId_userId_key" ON "group_members"("groupId", "userId");

-- CreateIndex
CREATE INDEX "expenses_groupId_deletedAt_expenseDate_idx" ON "expenses"("groupId", "deletedAt", "expenseDate");

-- CreateIndex
CREATE INDEX "expense_splits_userId_idx" ON "expense_splits"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_splits_expenseId_userId_key" ON "expense_splits"("expenseId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "group_settlements_idempotencyKey_key" ON "group_settlements"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "group_settlements_clientRequestId_key" ON "group_settlements"("clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "group_settlements_paymentIntentId_key" ON "group_settlements"("paymentIntentId");

-- CreateIndex
CREATE INDEX "group_settlements_groupId_createdAt_idx" ON "group_settlements"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "group_settlements_payerUserId_status_idx" ON "group_settlements"("payerUserId", "status");

-- CreateIndex
CREATE INDEX "group_settlements_payeeUserId_status_idx" ON "group_settlements"("payeeUserId", "status");

-- CreateIndex
CREATE INDEX "group_activities_groupId_createdAt_idx" ON "group_activities"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_contactUserId_fkey" FOREIGN KEY ("contactUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_groups" ADD CONSTRAINT "expense_groups_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paidByUserId_fkey" FOREIGN KEY ("paidByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_payeeUserId_fkey" FOREIGN KEY ("payeeUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_activities" ADD CONSTRAINT "group_activities_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "expense_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_activities" ADD CONSTRAINT "group_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
