import { randomUUID } from "node:crypto";
import { prisma, type TravelBooking, type TravelBookingStatus } from "@nexus/database";
import type { TravelBookingView, TravelTicketView, TravelCancellationView, TravelRefundView } from "@nexus/shared-types";
import type { TravelBookingCreateInput, TravelCancellationInput } from "@nexus/validation";
import { ApiError } from "@/lib/api/response";
import { getTravelAdapter } from "@/lib/travel/providers";
import { ensureTravelCollectionUser } from "@/lib/travel/collection-account";
import { searchRecipient } from "@/lib/payments/recipient-service";
import { getOrCreatePaymentIntent, executePaymentIntent } from "@/lib/payments/payment-service";
import { encryptSecret } from "@/lib/security/crypto";
import { publishSecurityEvent } from "@/lib/fraud/event-service";
import { securityAudit } from "@/lib/fraud/audit-service";

const TRANSITIONS: Record<TravelBookingStatus, TravelBookingStatus[]> = {
  DRAFT: ["VALIDATION_PENDING", "READY_FOR_PAYMENT", "FAILED"],
  VALIDATION_PENDING: ["READY_FOR_PAYMENT", "FAILED"],
  READY_FOR_PAYMENT: ["PAYMENT_PENDING", "FAILED"],
  PAYMENT_PENDING: ["PAYMENT_SETTLED", "FAILED", "UNKNOWN"],
  PAYMENT_SETTLED: ["PROVIDER_SUBMISSION_PENDING", "RECONCILIATION_REQUIRED", "REFUND_PENDING"],
  PROVIDER_SUBMISSION_PENDING: ["PROVIDER_PROCESSING", "CONFIRMED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  PROVIDER_PROCESSING: ["CONFIRMED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED"],
  CONFIRMED: ["CANCELLATION_PENDING", "COMPLETED"],
  FAILED: [], UNKNOWN: ["RECONCILIATION_REQUIRED", "CONFIRMED", "FAILED"],
  RECONCILIATION_REQUIRED: ["CONFIRMED", "FAILED", "REFUND_PENDING"],
  CANCELLATION_PENDING: ["CANCELLED", "UNKNOWN", "FAILED"],
  CANCELLED: ["REFUND_PENDING", "COMPLETED"],
  REFUND_PENDING: ["PARTIALLY_REFUNDED", "REFUNDED", "RECONCILIATION_REQUIRED"],
  PARTIALLY_REFUNDED: ["REFUNDED", "COMPLETED"],
  REFUNDED: ["COMPLETED"], COMPLETED: [],
};

const STAGE: Record<TravelBookingStatus, string> = {
  DRAFT: "Awaiting details", VALIDATION_PENDING: "Validating", READY_FOR_PAYMENT: "Ready for payment",
  PAYMENT_PENDING: "Wallet debit processing", PAYMENT_SETTLED: "Wallet debit confirmed",
  PROVIDER_SUBMISSION_PENDING: "Provider processing", PROVIDER_PROCESSING: "Provider processing",
  CONFIRMED: "Booking confirmed", FAILED: "Booking failed", UNKNOWN: "Outcome unknown",
  RECONCILIATION_REQUIRED: "Reconciliation required",
  CANCELLATION_PENDING: "Cancellation processing", CANCELLED: "Booking cancelled",
  REFUND_PENDING: "Refund pending", PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded", COMPLETED: "Completed",
};

export function bookingView(row: TravelBooking & { provider: { displayName: string }; passengers?: unknown[] }): TravelBookingView {
  return {
    id: row.id, reference: row.reference, category: row.category,
    providerName: row.provider.displayName, amountMinor: row.amountMinor, currency: row.currency,
    status: row.status, paymentRef: row.paymentRef, providerRef: row.providerRef,
    confirmedAt: row.confirmedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    isSandbox: true, passengerCount: Array.isArray(row.passengers) ? row.passengers.length : 0,
    notice: STAGE[row.status],
  };
}

async function load(userId: string, id: string) {
  const row = await prisma.travelBooking.findFirst({
    where: { OR: [{ id }, { reference: id }], userId },
    include: { provider: true, passengers: true },
  });
  if (!row) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel booking not found.");
  return row;
}

async function transition(bookingId: string, target: TravelBookingStatus, actor: string, evidence?: string) {
  const row = await prisma.travelBooking.findUniqueOrThrow({ where: { id: bookingId } });
  if (row.status === target) return;
  if (!TRANSITIONS[row.status].includes(target)) {
    throw new ApiError(409, "PAYMENT_ERROR", `Cannot move booking from ${row.status} to ${target}.`);
  }
  await prisma.$transaction([
    prisma.travelBooking.update({
      where: { id: bookingId },
      data: { status: target, ...(target === "CONFIRMED" ? { confirmedAt: new Date() } : {}) },
    }),
    prisma.travelBookingStatusHistory.create({
      data: { bookingId, fromStatus: row.status, toStatus: target, actor, evidence },
    }),
  ]);
}

async function openCase(input: { bookingId?: string; userId?: string; reason: string }) {
  const existing = await prisma.travelReconciliationCase.findFirst({
    where: { bookingId: input.bookingId, status: "OPEN" },
  });
  if (existing) return existing;
  return prisma.travelReconciliationCase.create({
    data: { reference: `travrecon_${randomUUID()}`, bookingId: input.bookingId ?? null, userId: input.userId ?? null, reason: input.reason },
  });
}

async function recordAttempt(bookingId: string, outcome: string, detail?: string) {
  const count = await prisma.travelBookingAttempt.count({ where: { bookingId } });
  await prisma.travelBookingAttempt.create({ data: { bookingId, attemptNo: count + 1, outcome, detail } }).catch(() => undefined);
}

export async function createBooking(userId: string, input: TravelBookingCreateInput) {
  const existing = await prisma.travelBooking.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing && existing.userId === userId) return bookingView(await load(userId, existing.id));
  if (existing) throw new ApiError(409, "PAYMENT_ERROR", "Idempotency key already used.");

  const search = await prisma.travelSearch.findFirst({ where: { id: input.searchId, userId }, include: { provider: true } });
  if (!search) throw new ApiError(404, "AUTHORIZATION_ERROR", "Travel search not found.");
  const result = await prisma.travelSearchResultSnapshot.findFirst({ where: { id: input.resultId, searchId: search.id } });
  if (!result?.productId) throw new ApiError(404, "PAYMENT_ERROR", "Search result not found.");
  const price = await prisma.travelPriceSnapshot.findFirst({
    where: { productId: result.productId, searchId: search.id }, orderBy: { capturedAt: "desc" },
  });
  if (!price) throw new ApiError(409, "PAYMENT_ERROR", "No verified fare is available for this result.");
  if (price.validUntil && price.validUntil <= new Date()) {
    throw new ApiError(409, "PAYMENT_ERROR", "This fare has expired. Revalidate it before booking.");
  }
  if (search.expiresAt && search.expiresAt <= new Date()) {
    throw new ApiError(409, "PAYMENT_ERROR", "This search result is stale. Start a new search.");
  }
  const adapter = getTravelAdapter(search.provider.code);
  if (!adapter.capabilities.booking) throw new ApiError(409, "PAYMENT_ERROR", "This provider does not support booking.");

  const encrypted = encryptSecret(JSON.stringify(input.passengers));
  const row = await prisma.travelBooking.create({
    data: {
      reference: `travel_${randomUUID()}`, userId, providerId: search.providerId,
      category: search.category, searchId: search.id, productId: result.productId,
      idempotencyKey: input.idempotencyKey,
      providerRequestRef: `travreq_${randomUUID().replace(/-/g, "")}`,
      amountMinor: price.amountMinor, currency: price.currency, priceSnapshotId: price.id,
      status: "READY_FOR_PAYMENT",
      passengers: {
        create: input.passengers.map((p) => ({
          firstName: p.firstName, lastName: p.lastName,
          dateOfBirth: p.dateOfBirth ? new Date(p.dateOfBirth) : null,
          documentType: null,
          documentMasked: null,
          encryptedDetails: encryptSecret(JSON.stringify(p)),
        })),
      },
    },
    include: { provider: true, passengers: true },
  });
  void encrypted;
  await prisma.travelBookingStatusHistory.create({
    data: { bookingId: row.id, toStatus: "DRAFT", actor: userId },
  });
  await publishSecurityEvent({
    eventId: `travel_booking_${row.id}`, type: "TRAVEL_BOOKING_INITIATED", occurredAt: new Date(),
    actorId: userId, subjectId: row.id, sourceModule: "travel", transactionRef: row.reference,
    metadata: { category: search.category, amountMinor: price.amountMinor },
  });
  return bookingView(row);
}

export async function listBookings(userId: string, status?: string) {
  const rows = await prisma.travelBooking.findMany({
    where: { userId, ...(status ? { status: status as TravelBookingStatus } : {}) },
    include: { provider: true, passengers: true }, orderBy: { createdAt: "desc" }, take: 100,
  });
  return rows.map((row) => bookingView(row));
}

export async function getBooking(userId: string, id: string) { return bookingView(await load(userId, id)); }

/**
 * Two-system orchestration: wallet settlement through the EXISTING engine,
 * then provider booking. Never mutates balances and never creates a second intent.
 */
export async function confirmBooking(userId: string, id: string) {
  const booking = await load(userId, id);
  if (!["DRAFT", "VALIDATION_PENDING", "READY_FOR_PAYMENT", "UNKNOWN", "RECONCILIATION_REQUIRED"].includes(booking.status)) {
    return bookingView(booking); // idempotent replay of a decided booking
  }
  await transition(booking.id, "PAYMENT_PENDING", userId);
  const provider = await prisma.travelProvider.findUniqueOrThrow({ where: { id: booking.providerId } });
  const collection = await ensureTravelCollectionUser(provider.code);
  const recipient = await searchRecipient(userId, collection.username);

  let engineResult;
  try {
    const intent = await getOrCreatePaymentIntent(userId, {
      clientRequestId: booking.idempotencyKey,
      recipientToken: recipient.recipientToken,
      amountMinor: booking.amountMinor,
      description: `Travel booking ${booking.reference}`,
    });
    await prisma.travelBooking.update({ where: { id: booking.id }, data: { paymentIntentId: intent.id } });
    await recordAttempt(booking.id, "WALLET_SUBMISSION", intent.id);
    engineResult = await executePaymentIntent(intent.id, userId);
  } catch (error) {
    await recordAttempt(booking.id, "WALLET_ERROR", error instanceof Error ? error.message.slice(0, 300) : "Engine error");
    throw error;
  }

  if (engineResult.status === "REJECTED") {
    await transition(booking.id, "FAILED", "system", engineResult.rejectionCode ?? "Wallet settlement rejected");
    await publishSecurityEvent({ eventId: `travel_fail_${booking.id}`, type: "TRAVEL_BOOKING_FAILED", occurredAt: new Date(), actorId: userId, subjectId: booking.id, sourceModule: "travel" });
    return bookingView(await load(userId, booking.id));
  }
  if (engineResult.status === "UNKNOWN" || engineResult.status === "RECONCILIATION_REQUIRED") {
    await transition(booking.id, "UNKNOWN", "system", "Wallet outcome unknown");
    await openCase({ bookingId: booking.id, userId, reason: "WALLET_OUTCOME_UNKNOWN" });
    return bookingView(await load(userId, booking.id));
  }
  if (engineResult.status !== "SETTLED" || !engineResult.paymentRef) {
    await transition(booking.id, "RECONCILIATION_REQUIRED", "system", "Wallet settlement incomplete");
    await openCase({ bookingId: booking.id, userId, reason: "WALLET_STATUS_INCOMPLETE" });
    return bookingView(await load(userId, booking.id));
  }

  await prisma.travelBooking.update({ where: { id: booking.id }, data: { paymentRef: engineResult.paymentRef } });
  await transition(booking.id, "PAYMENT_SETTLED", "system", engineResult.paymentRef);
  await publishSecurityEvent({
    eventId: `travel_wallet_${booking.id}`, type: "TRAVEL_BOOKING_CONFIRMED", occurredAt: new Date(),
    actorId: userId, subjectId: booking.id, sourceModule: "travel", transactionRef: engineResult.paymentRef,
    metadata: { stage: "WALLET_SETTLED_ONLY", notice: "Wallet debit confirmed. Provider booking status is separate." },
  });

  const adapter = getTravelAdapter(provider.code);
  await transition(booking.id, "PROVIDER_SUBMISSION_PENDING", "system");
  const productCode = booking.productId
    ? (await prisma.travelProduct.findUnique({ where: { id: booking.productId } }))?.code ?? booking.reference
    : booking.reference;
  let providerResult;
  try {
    providerResult = await adapter.createBooking({
      productCode, providerRequestRef: booking.providerRequestRef,
      passengers: booking.passengers.map((p) => ({ firstName: p.firstName, lastName: p.lastName })),
      amountMinor: booking.amountMinor,
    });
  } catch { providerResult = null; }
  await recordAttempt(booking.id, providerResult ? "PROVIDER_SUBMITTED" : "PROVIDER_ERROR", providerResult?.providerRef);
  if (!providerResult) {
    await transition(booking.id, "UNKNOWN", "system", "Provider response unknown");
    await openCase({ bookingId: booking.id, userId, reason: "PROVIDER_RESPONSE_UNKNOWN" });
    return bookingView(await load(userId, booking.id));
  }
  await prisma.travelBooking.update({ where: { id: booking.id }, data: { providerRef: providerResult.providerRef } });
  await transition(booking.id, "PROVIDER_PROCESSING", "system", providerResult.providerRef);

  const status = await adapter.getBookingStatus(providerResult.providerRef);
  if (status?.status === "CONFIRMED") {
    await transition(booking.id, "CONFIRMED", "provider", providerResult.providerRef);
    await publishSecurityEvent({
      eventId: `travel_confirmed_${booking.id}`, type: "TRAVEL_BOOKING_CONFIRMED", occurredAt: new Date(),
      actorId: userId, subjectId: booking.id, sourceModule: "travel", transactionRef: providerResult.providerRef,
      metadata: { stage: "PROVIDER_CONFIRMED", walletPaymentRef: engineResult.paymentRef },
    });
    await securityAudit({
      actorType: "SYSTEM", actorId: "travel-orchestrator", action: "TRAVEL_BOOKING_CONFIRMED",
      targetType: "travel_booking", targetId: booking.id,
      metadata: { walletPaymentRef: engineResult.paymentRef, providerRef: providerResult.providerRef },
    });
    const ticket = await adapter.retrieveTicket(providerResult.providerRef);
    if (ticket) {
      await prisma.travelTicket.create({
        data: {
          bookingId: booking.id, userId, providerRef: ticket.providerRef,
          ticketNumber: ticket.ticketNumber, status: ticket.status, issuedAt: ticket.issuedAt,
        },
      });
      await transition(booking.id, "CONFIRMED", "provider", ticket.ticketNumber);
    }
  } else {
    await transition(booking.id, "RECONCILIATION_REQUIRED", "system", "Provider booking failed after wallet settlement");
    await openCase({ bookingId: booking.id, userId, reason: "PROVIDER_BOOKING_FAILED_AFTER_SETTLEMENT" });
    await publishSecurityEvent({
      eventId: `travel_fail_${booking.id}`, type: "TRAVEL_BOOKING_FAILED", occurredAt: new Date(),
      actorId: userId, subjectId: booking.id, sourceModule: "travel", transactionRef: providerResult.providerRef,
      metadata: { stage: "PROVIDER", walletPaymentRef: engineResult.paymentRef },
    });
  }
  return bookingView(await load(userId, booking.id));
}

export async function getBookingHistory(userId: string, id: string) {
  await load(userId, id);
  return prisma.travelBookingStatusHistory.findMany({ where: { bookingId: id }, orderBy: { createdAt: "asc" } });
}

export async function listTickets(userId: string, bookingId: string) {
  await load(userId, bookingId);
  const rows = await prisma.travelTicket.findMany({ where: { bookingId, userId }, orderBy: { createdAt: "desc" } });
  return rows.map(ticketView);
}

function ticketView(row: {
  id: string; providerRef: string; ticketNumber: string | null; status: string;
  issuedAt: Date | null; fileName: string | null; storagePath: string | null;
}): TravelTicketView {
  return {
    id: row.id, providerRef: row.providerRef, ticketNumber: row.ticketNumber,
    status: row.status, issuedAt: row.issuedAt?.toISOString() ?? null,
    fileName: row.fileName, hasDocument: Boolean(row.storagePath),
  };
}

export async function cancelBooking(userId: string, id: string, input: TravelCancellationInput) {
  const booking = await load(userId, id);
  if (!["CONFIRMED"].includes(booking.status)) {
    throw new ApiError(409, "PAYMENT_ERROR", "This booking cannot be cancelled in its current state.");
  }
  const provider = await prisma.travelProvider.findUniqueOrThrow({ where: { id: booking.providerId } });
  const adapter = getTravelAdapter(provider.code);
  if (!adapter.capabilities.cancellation || !booking.providerRef) {
    throw new ApiError(409, "PAYMENT_ERROR", "Cancellation is unsupported for this booking. Use the official provider channel.");
  }
  await transition(booking.id, "CANCELLATION_PENDING", userId, input.reason);
  const result = await adapter.cancelBooking(booking.providerRef, input.reason).catch(() => null);
  if (!result) {
    await prisma.travelCancellation.create({
      data: { bookingId: booking.id, status: "UNKNOWN", reason: input.reason },
    });
    await openCase({ bookingId: booking.id, userId, reason: "CANCELLATION_OUTCOME_UNKNOWN" });
    return bookingView(await load(userId, booking.id));
  }
  const cancellation = await prisma.travelCancellation.create({
    data: {
      bookingId: booking.id, providerRef: result.providerRef, status: result.status as never,
      reason: input.reason, chargesMinor: result.chargesMinor ?? 0,
      estimatedRefundMinor: result.estimatedRefundMinor ?? null,
      confirmedAt: new Date(),
    },
  });
  await transition(booking.id, "CANCELLED", "provider", result.providerRef);
  await publishSecurityEvent({
    eventId: `travel_cancel_${booking.id}`, type: "TRAVEL_CANCELLATION_REQUESTED", occurredAt: new Date(),
    actorId: userId, subjectId: booking.id, sourceModule: "travel", metadata: { providerRef: result.providerRef },
  });
  // Refund status is queried from the provider; never assume a completed refund.
  const refund = await adapter.getRefundStatus(result.providerRef);
  if (!refund || refund.status !== "REFUNDED") {
    await prisma.travelRefund.create({
      data: {
        bookingId: booking.id, cancellationId: cancellation.id, providerRef: result.providerRef,
        amountMinor: result.estimatedRefundMinor ?? 0, status: "PENDING",
      },
    }).catch(() => undefined);
    await transition(booking.id, "REFUND_PENDING", "system", "Refund not confirmed by provider");
    await openCase({ bookingId: booking.id, userId, reason: "REFUND_UNCONFIRMED" });
  }
  return bookingView(await load(userId, booking.id));
}

export async function listCancellations(userId: string, bookingId: string): Promise<TravelCancellationView[]> {
  await load(userId, bookingId);
  const rows = await prisma.travelCancellation.findMany({ where: { bookingId }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id, providerRef: row.providerRef, status: row.status, chargesMinor: row.chargesMinor,
    estimatedRefundMinor: row.estimatedRefundMinor, confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    notice: "Estimated refunds are provider-reported and are not a completed refund.",
  }));
}

export async function listRefunds(userId: string, bookingId: string): Promise<TravelRefundView[]> {
  await load(userId, bookingId);
  const rows = await prisma.travelRefund.findMany({ where: { bookingId }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => ({
    id: row.id, providerRef: row.providerRef, amountMinor: row.amountMinor,
    status: row.status, confirmedAt: row.confirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export const TRAVEL_BOOKING_TRANSITIONS = TRANSITIONS;

