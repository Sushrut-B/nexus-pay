-- CreateEnum
CREATE TYPE "TravelProviderMode" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "TravelCategory" AS ENUM ('FLIGHT', 'TRAIN', 'BUS', 'HOTEL', 'CAB', 'AIRPORT_TRANSFER', 'LOCAL_MOBILITY');

-- CreateEnum
CREATE TYPE "TravelSearchStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TravelBookingStatus" AS ENUM ('DRAFT', 'VALIDATION_PENDING', 'READY_FOR_PAYMENT', 'PAYMENT_PENDING', 'PAYMENT_SETTLED', 'PROVIDER_SUBMISSION_PENDING', 'PROVIDER_PROCESSING', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'CANCELLATION_PENDING', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TravelCancellationStatus" AS ENUM ('CANCELLATION_REQUESTED', 'CANCELLATION_PROCESSING', 'CANCELLATION_CONFIRMED', 'CANCELLATION_FAILED', 'REFUND_PENDING', 'REFUND_PARTIAL', 'REFUND_COMPLETED', 'REFUND_FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TravelDocumentStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "TravelTripMemberRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TravelWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "TravelSyncStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "TravelExpenseStatus" AS ENUM ('ESTIMATED', 'PENDING', 'CONFIRMED', 'REFUNDED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_BOOKING_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_TICKET_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_BOOKING_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_CANCELLATION_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_REFUND_STATUS';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_DEPARTURE_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_CHECKIN_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_TRIP_STARTING';
ALTER TYPE "NotificationType" ADD VALUE 'TRAVEL_DOCUMENT_REMINDER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_SEARCH_CREATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_BOOKING_INITIATED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_BOOKING_CONFIRMED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_CANCELLATION_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_REFUND_REQUESTED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TRAVEL_PASSENGER_DETAILS_CHANGED';
ALTER TYPE "SecurityEventType" ADD VALUE 'UNUSUAL_BOOKING_ATTEMPT';

-- CreateTable
CREATE TABLE "travel_providers" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "displayName" VARCHAR(160) NOT NULL,
    "mode" "TravelProviderMode" NOT NULL DEFAULT 'SANDBOX',
    "status" VARCHAR(30) NOT NULL DEFAULT 'UNAVAILABLE',
    "capabilities" JSONB NOT NULL,
    "config" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_provider_capabilities" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "travel_provider_capabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_searches" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "providerId" TEXT NOT NULL,
    "category" "TravelCategory" NOT NULL,
    "status" "TravelSearchStatus" NOT NULL DEFAULT 'PENDING',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "providerRef" VARCHAR(160),
    "error" VARCHAR(500),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_search_result_snapshots" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "productId" VARCHAR(120),
    "payload" JSONB NOT NULL,
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "travel_search_result_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_products" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "category" "TravelCategory" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_price_snapshots" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "searchId" VARCHAR(80),
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "fareRules" JSONB NOT NULL DEFAULT '{}',
    "refundable" BOOLEAN NOT NULL DEFAULT false,
    "validUntil" TIMESTAMP(3),
    "source" VARCHAR(30) NOT NULL DEFAULT 'SANDBOX_FIXTURE',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_bookings" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "providerId" TEXT NOT NULL,
    "category" "TravelCategory" NOT NULL,
    "searchId" VARCHAR(80),
    "productId" VARCHAR(80),
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "providerRequestRef" VARCHAR(160) NOT NULL,
    "providerRef" VARCHAR(160),
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "priceSnapshotId" VARCHAR(80),
    "status" "TravelBookingStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentIntentId" VARCHAR(120),
    "paymentRef" VARCHAR(160),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_booking_attempts" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "outcome" VARCHAR(40) NOT NULL,
    "detail" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_booking_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_passengers" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "firstName" VARCHAR(120) NOT NULL,
    "lastName" VARCHAR(120) NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "documentType" VARCHAR(40),
    "documentMasked" VARCHAR(80),
    "encryptedDetails" VARCHAR(2048),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_booking_status_history" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "fromStatus" "TravelBookingStatus",
    "toStatus" "TravelBookingStatus" NOT NULL,
    "actor" VARCHAR(80) NOT NULL,
    "evidence" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_tickets" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "providerRef" VARCHAR(160) NOT NULL,
    "ticketNumber" VARCHAR(120),
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "storagePath" VARCHAR(1024),
    "fileName" VARCHAR(200),
    "contentType" VARCHAR(100),
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_cancellations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "providerRef" VARCHAR(160),
    "status" "TravelCancellationStatus" NOT NULL DEFAULT 'CANCELLATION_REQUESTED',
    "reason" VARCHAR(500),
    "chargesMinor" INTEGER NOT NULL DEFAULT 0,
    "estimatedRefundMinor" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_refunds" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "cancellationId" VARCHAR(80),
    "providerRef" VARCHAR(160) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_provider_webhooks" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "eventId" VARCHAR(180) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "TravelWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" VARCHAR(500),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_provider_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_provider_syncs" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" VARCHAR(60) NOT NULL,
    "status" "TravelSyncStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "error" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_provider_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_trips" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "destination" VARCHAR(200),
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" VARCHAR(1000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_trip_members" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "role" "TravelTripMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_trip_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_itinerary_items" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "bookingId" VARCHAR(80),
    "category" "TravelCategory" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "startTimeZone" VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
    "endTimeZone" VARCHAR(60),
    "location" VARCHAR(200),
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_itinerary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_documents" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "tripId" VARCHAR(80),
    "bookingId" VARCHAR(80),
    "kind" VARCHAR(60) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" VARCHAR(1024),
    "status" "TravelDocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_budgets" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "categories" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_expenses" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "status" "TravelExpenseStatus" NOT NULL DEFAULT 'CONFIRMED',
    "description" VARCHAR(300),
    "bookingId" VARCHAR(80),
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_saved_destinations" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "code" VARCHAR(120) NOT NULL,
    "category" "TravelCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_saved_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" VARCHAR(80) NOT NULL,
    "bookingUpdates" BOOLEAN NOT NULL DEFAULT true,
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "refundUpdates" BOOLEAN NOT NULL DEFAULT true,
    "documentReminders" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_reconciliation_cases" (
    "id" TEXT NOT NULL,
    "reference" VARCHAR(120) NOT NULL,
    "userId" VARCHAR(80),
    "bookingId" VARCHAR(80),
    "reason" VARCHAR(120) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    "assignedTo" VARCHAR(120),
    "resolution" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "travel_reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travel_providers_code_key" ON "travel_providers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "travel_provider_capabilities_providerId_capability_key" ON "travel_provider_capabilities"("providerId", "capability");

-- CreateIndex
CREATE INDEX "travel_searches_userId_createdAt_idx" ON "travel_searches"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "travel_search_result_snapshots_searchId_retrievedAt_idx" ON "travel_search_result_snapshots"("searchId", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_products_code_key" ON "travel_products"("code");

-- CreateIndex
CREATE INDEX "travel_products_providerId_category_status_idx" ON "travel_products"("providerId", "category", "status");

-- CreateIndex
CREATE INDEX "travel_price_snapshots_productId_capturedAt_idx" ON "travel_price_snapshots"("productId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_reference_key" ON "travel_bookings"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_idempotencyKey_key" ON "travel_bookings"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "travel_bookings_providerRequestRef_key" ON "travel_bookings"("providerRequestRef");

-- CreateIndex
CREATE INDEX "travel_bookings_userId_createdAt_idx" ON "travel_bookings"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "travel_bookings_status_createdAt_idx" ON "travel_bookings"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_booking_attempts_bookingId_attemptNo_key" ON "travel_booking_attempts"("bookingId", "attemptNo");

-- CreateIndex
CREATE INDEX "travel_passengers_bookingId_idx" ON "travel_passengers"("bookingId");

-- CreateIndex
CREATE INDEX "travel_booking_status_history_bookingId_createdAt_idx" ON "travel_booking_status_history"("bookingId", "createdAt");

-- CreateIndex
CREATE INDEX "travel_tickets_userId_createdAt_idx" ON "travel_tickets"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_tickets_bookingId_providerRef_key" ON "travel_tickets"("bookingId", "providerRef");

-- CreateIndex
CREATE INDEX "travel_cancellations_bookingId_createdAt_idx" ON "travel_cancellations"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_refunds_bookingId_providerRef_key" ON "travel_refunds"("bookingId", "providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "travel_provider_webhooks_providerId_eventId_key" ON "travel_provider_webhooks"("providerId", "eventId");

-- CreateIndex
CREATE INDEX "travel_provider_syncs_status_nextAttemptAt_idx" ON "travel_provider_syncs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "travel_trips_userId_status_idx" ON "travel_trips"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "travel_trip_members_tripId_userId_key" ON "travel_trip_members"("tripId", "userId");

-- CreateIndex
CREATE INDEX "travel_itinerary_items_tripId_startAt_idx" ON "travel_itinerary_items"("tripId", "startAt");

-- CreateIndex
CREATE INDEX "travel_documents_userId_createdAt_idx" ON "travel_documents"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_budgets_tripId_key" ON "travel_budgets"("tripId");

-- CreateIndex
CREATE INDEX "travel_expenses_tripId_occurredAt_idx" ON "travel_expenses"("tripId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_saved_destinations_userId_code_category_key" ON "travel_saved_destinations"("userId", "code", "category");

-- CreateIndex
CREATE UNIQUE INDEX "travel_notification_preferences_userId_key" ON "travel_notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "travel_reconciliation_cases_reference_key" ON "travel_reconciliation_cases"("reference");

-- CreateIndex
CREATE INDEX "travel_reconciliation_cases_status_createdAt_idx" ON "travel_reconciliation_cases"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "travel_provider_capabilities" ADD CONSTRAINT "travel_provider_capabilities_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_searches" ADD CONSTRAINT "travel_searches_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_search_result_snapshots" ADD CONSTRAINT "travel_search_result_snapshots_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "travel_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_products" ADD CONSTRAINT "travel_products_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_price_snapshots" ADD CONSTRAINT "travel_price_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "travel_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_bookings" ADD CONSTRAINT "travel_bookings_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_attempts" ADD CONSTRAINT "travel_booking_attempts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_passengers" ADD CONSTRAINT "travel_passengers_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_booking_status_history" ADD CONSTRAINT "travel_booking_status_history_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_tickets" ADD CONSTRAINT "travel_tickets_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_cancellations" ADD CONSTRAINT "travel_cancellations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_refunds" ADD CONSTRAINT "travel_refunds_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "travel_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_provider_webhooks" ADD CONSTRAINT "travel_provider_webhooks_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_provider_syncs" ADD CONSTRAINT "travel_provider_syncs_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "travel_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_trip_members" ADD CONSTRAINT "travel_trip_members_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_itinerary_items" ADD CONSTRAINT "travel_itinerary_items_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_documents" ADD CONSTRAINT "travel_documents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_budgets" ADD CONSTRAINT "travel_budgets_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_expenses" ADD CONSTRAINT "travel_expenses_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "travel_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
