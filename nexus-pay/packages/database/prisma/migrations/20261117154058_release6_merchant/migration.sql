-- CreateEnum
CREATE TYPE "MerchantType" AS ENUM ('INDIVIDUAL_BUSINESS', 'SOLE_PROPRIETORSHIP', 'SMALL_BUSINESS', 'COMPANY', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "MerchantOrderStatus" AS ENUM ('DRAFT', 'CREATED', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAID', 'EXPIRED', 'CANCELLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED', 'RETRY_PENDING', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "handle" VARCHAR(40) NOT NULL,
    "businessName" VARCHAR(120) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "businessType" "MerchantType" NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "description" VARCHAR(600),
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "website" VARCHAR(2048),
    "address" VARCHAR(400),
    "logoUrl" VARCHAR(2048),
    "brandColor" VARCHAR(20),
    "supportEmail" VARCHAR(254),
    "supportPhone" VARCHAR(20),
    "refundPolicy" VARCHAR(1000),
    "currency" VARCHAR(3) NOT NULL,
    "status" "MerchantStatus" NOT NULL DEFAULT 'DRAFT',
    "raftlineAccountId" VARCHAR(80),
    "walletId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_members" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'STAFF',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "merchant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_approval_events" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "fromStatus" "MerchantStatus" NOT NULL,
    "toStatus" "MerchantStatus" NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_orders" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600),
    "customerName" VARCHAR(120),
    "customerEmail" VARCHAR(254),
    "customerPhone" VARCHAR(20),
    "subtotalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "MerchantOrderStatus" NOT NULL DEFAULT 'CREATED',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "sku" VARCHAR(80),

    CONSTRAINT "merchant_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_customers" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "totalPaidMinor" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "firstPurchaseAt" TIMESTAMP(3),
    "lastPurchaseAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_payments" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT,
    "customerUserId" TEXT NOT NULL,
    "paymentIntentId" VARCHAR(64) NOT NULL,
    "paymentRef" VARCHAR(80) NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "merchant_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_checkout_sessions" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT,
    "token" VARCHAR(80) NOT NULL,
    "clientRequestId" VARCHAR(64) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_payment_links" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "orderId" TEXT,
    "token" VARCHAR(80) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(600),
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "customerName" VARCHAR(120),
    "customerEmail" VARCHAR(254),
    "maxPayments" INTEGER,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "totalCollectedMinor" INTEGER NOT NULL DEFAULT 0,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "redirectUrl" VARCHAR(2048),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_refund_requests" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewNote" VARCHAR(500),
    "executionNote" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "merchant_refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_api_keys" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "keyPrefix" VARCHAR(20) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "url" VARCHAR(2048) NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "signingSecret" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_events" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "eventType" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "responseCode" INTEGER,
    "error" VARCHAR(500),
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_report_exports" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_handle_key" ON "merchants"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_raftlineAccountId_key" ON "merchants"("raftlineAccountId");

-- CreateIndex
CREATE INDEX "merchants_ownerUserId_status_idx" ON "merchants"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "merchants_status_createdAt_idx" ON "merchants"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_members_merchantId_userId_key" ON "merchant_members"("merchantId", "userId");

-- CreateIndex
CREATE INDEX "merchant_approval_events_merchantId_createdAt_idx" ON "merchant_approval_events"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_orders_merchantId_status_createdAt_idx" ON "merchant_orders"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_order_items_orderId_idx" ON "merchant_order_items"("orderId");

-- CreateIndex
CREATE INDEX "merchant_customers_merchantId_lastPurchaseAt_idx" ON "merchant_customers"("merchantId", "lastPurchaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_customers_merchantId_userId_key" ON "merchant_customers"("merchantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payments_paymentIntentId_key" ON "merchant_payments"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payments_paymentRef_key" ON "merchant_payments"("paymentRef");

-- CreateIndex
CREATE INDEX "merchant_payments_merchantId_createdAt_idx" ON "merchant_payments"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_payments_customerUserId_createdAt_idx" ON "merchant_payments"("customerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_checkout_sessions_token_key" ON "merchant_checkout_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_checkout_sessions_clientRequestId_key" ON "merchant_checkout_sessions"("clientRequestId");

-- CreateIndex
CREATE INDEX "merchant_checkout_sessions_merchantId_createdAt_idx" ON "merchant_checkout_sessions"("merchantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payment_links_token_key" ON "merchant_payment_links"("token");

-- CreateIndex
CREATE INDEX "merchant_payment_links_merchantId_status_createdAt_idx" ON "merchant_payment_links"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "merchant_refund_requests_merchantId_status_createdAt_idx" ON "merchant_refund_requests"("merchantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_api_keys_keyHash_key" ON "merchant_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "merchant_api_keys_merchantId_revokedAt_idx" ON "merchant_api_keys"("merchantId", "revokedAt");

-- CreateIndex
CREATE INDEX "merchant_webhook_endpoints_merchantId_enabled_idx" ON "merchant_webhook_endpoints"("merchantId", "enabled");

-- CreateIndex
CREATE INDEX "merchant_webhook_events_status_availableAt_idx" ON "merchant_webhook_events"("status", "availableAt");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_status_nextAttemptAt_idx" ON "merchant_webhook_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "merchant_report_exports_merchantId_createdAt_idx" ON "merchant_report_exports"("merchantId", "createdAt");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_approval_events" ADD CONSTRAINT "merchant_approval_events_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_orders" ADD CONSTRAINT "merchant_orders_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_order_items" ADD CONSTRAINT "merchant_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_customers" ADD CONSTRAINT "merchant_customers_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payments" ADD CONSTRAINT "merchant_payments_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payments" ADD CONSTRAINT "merchant_payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payments" ADD CONSTRAINT "merchant_payments_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_checkout_sessions" ADD CONSTRAINT "merchant_checkout_sessions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_checkout_sessions" ADD CONSTRAINT "merchant_checkout_sessions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payment_links" ADD CONSTRAINT "merchant_payment_links_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payment_links" ADD CONSTRAINT "merchant_payment_links_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "merchant_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_refund_requests" ADD CONSTRAINT "merchant_refund_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "merchant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_endpoints" ADD CONSTRAINT "merchant_webhook_endpoints_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_events" ADD CONSTRAINT "merchant_webhook_events_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "merchant_webhook_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "merchant_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_report_exports" ADD CONSTRAINT "merchant_report_exports_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
