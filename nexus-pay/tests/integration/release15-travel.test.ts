import { randomUUID } from "node:crypto";
import path from "node:path";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRaftlineClient } from "../../packages/api-client/src/index";
import { prisma } from "../../packages/database/src/index";
import type { ApiError } from "../../apps/web/lib/api/response";

const enabled = process.env.RUN_INTEGRATION === "1";
const stamp = Date.now().toString().slice(-9);
let svc: any;
const createdUserIds: string[] = [];

async function expectApiError(promise: Promise<unknown>, status: number) {
  try { await promise; throw new Error(`Expected API error ${status}`); }
  catch (error) { expect((error as ApiError).status).toBe(status); }
}

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      id: `r15_${stamp}_${label}`,
      fullName: `Release Fifteen ${label}`,
      email: `r15_${stamp}_${label}@example.test`,
      phoneNumber: `+91${randomUUID().replace(/\D/g, "").padEnd(10, "0").slice(0, 10)}`,
      passwordHash: "integration-only",
      username: `r15${stamp.slice(-6)}${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      onboardingCompletedAt: new Date(), isEmailVerified: true, isPhoneVerified: true,
      profile: { create: { displayName: `Release Fifteen ${label}`, preferredCurrency: "INR", preferredLanguage: "en-IN" } },
    },
  });
  createdUserIds.push(user.id);
  const accountId = `np_r15_${user.id}_inr`.replace(/[^A-Za-z0-9_.-]/g, "_");
  await createRaftlineClient().ensureAccount({ accountId, currency: "INR", metadata: { source: "release15-test" } });
  const wallet = await prisma.wallet.create({
    data: { userId: user.id, currency: "INR", walletType: "CUSTOMER", status: "ACTIVE", raftlineAccountId: accountId, provisionedAt: new Date() },
  });
  return { user, wallet, accountId };
}

async function fund(userId: string, amountMinor = 10_000_00) {
  const created = await svc.funding.getOrCreateFundingOperation(userId, {
    clientRequestId: `fund-${randomUUID()}`, amountMinor,
  });
  return svc.funding.executeFundingOperation(created.id, userId);
}

async function search(userId: string, category: "FLIGHT" | "BUS" | "HOTEL" = "FLIGHT") {
  return svc.search.createSearch(userId, {
    category, origin: "BLR", destination: "DEL",
    departureDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    passengers: 1,
  });
}

async function bookingFor(userId: string, key: string) {
  const result = await search(userId);
  const resultId = result.results[0]!.id;
  const revalidated = await svc.search.revalidateResult(userId, result.id, resultId);
  const booking = await svc.booking.createBooking(userId, {
    searchId: result.id, resultId,
    passengers: [{ firstName: "Test", lastName: "Traveller" }],
    idempotencyKey: key, termsAccepted: true,
  });
  return { result, resultId, revalidated, booking };
}

beforeAll(async () => {
  if (!enabled) return;
  dotenv.config({ path: path.resolve(process.cwd(), "apps/web/.env.local"), override: false });
  svc = {
    search: await import("../../apps/web/lib/travel/search-service"),
    booking: await import("../../apps/web/lib/travel/booking-service"),
    trip: await import("../../apps/web/lib/travel/trip-service"),
    document: await import("../../apps/web/lib/travel/document-service"),
    control: await import("../../apps/web/lib/travel/travel-control-service"),
    webhook: await import("../../apps/web/lib/travel/travel-webhook-service"),
    bootstrap: await import("../../apps/web/lib/travel/travel-worker-bootstrap"),
    funding: await import("../../apps/web/lib/payments/funding-service"),
    insights: await import("../../apps/web/lib/finance-intelligence/classification-service"),
  };
  await svc.bootstrap.ensureTravelConfiguration();
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.user.deleteMany({ where: { email: { startsWith: `r15_${stamp}` } } });
  await prisma.$disconnect().catch(() => undefined);
});

describe.skipIf(!enabled)("Release 15 travel verification", () => {
  it("TRV-01: provider is sandbox-only and categories are labelled", async () => {
    const provider = await prisma.travelProvider.findFirst({ where: { status: "AVAILABLE" } });
    expect(provider?.mode).toBe("SANDBOX");
    const categories = await prisma.travelProviderCapability.count({ where: { providerId: provider!.id, enabled: true } });
    expect(categories).toBeGreaterThan(5);
  }, 120_000);

  it("TRV-02: search returns provider-backed, labelled snapshots", async () => {
    const { user } = await createUser("search");
    const result = await search(user.id);
    expect(result.status).toBe("COMPLETED");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((item: { isSandbox: boolean }) => item.isSandbox)).toBe(true);
    expect(result.notice).toContain("provider-reported");
  }, 120_000);

  it("TRV-03: fare revalidation produces a fresh, dated price", async () => {
    const { user } = await createUser("revalidate");
    const result = await search(user.id);
    const revalidated = await svc.search.revalidateResult(user.id, result.id, result.results[0]!.id);
    expect(revalidated.amountMinor).toBeGreaterThan(0);
    expect(revalidated.validUntil).toBeTruthy();
    expect(revalidated.notice).toContain("not a confirmed booking");
  }, 120_000);

  it("FIN-04: wallet settlement and provider booking confirmation are recorded separately", async () => {
    const { user } = await createUser("pay");
    await fund(user.id);
    const { booking } = await bookingFor(user.id, `travel-${stamp}-pay`);
    const confirmed = await svc.booking.confirmBooking(user.id, booking.id);
    expect(confirmed.status).toBe("CONFIRMED");
    const row = await prisma.travelBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.paymentRef).toBeTruthy();
    expect(row.providerRef).toBeTruthy();
    expect(row.paymentRef).not.toBe(row.providerRef);
    const history = await prisma.travelBookingStatusHistory.findMany({ where: { bookingId: row.id } });
    expect(history.some((h: { toStatus: string }) => h.toStatus === "PAYMENT_SETTLED")).toBe(true);
    expect(history.some((h: { toStatus: string }) => h.toStatus === "CONFIRMED")).toBe(true);
    expect(await prisma.travelTicket.count({ where: { bookingId: row.id } })).toBeGreaterThan(0);
  }, 120_000);

  it("FIN-05: duplicate booking attempts reuse one intent and one payment", async () => {
    const { user } = await createUser("dup");
    await fund(user.id);
    const { booking } = await bookingFor(user.id, `travel-${stamp}-dup`);
    const stored = await prisma.travelBooking.findUniqueOrThrow({ where: { id: booking.id } });
    const second = await svc.booking.createBooking(user.id, {
      searchId: stored.searchId!, resultId: (await prisma.travelSearchResultSnapshot.findFirst({ where: { searchId: stored.searchId! } }))!.id,
      passengers: [{ firstName: "Test", lastName: "Traveller" }],
      idempotencyKey: `travel-${stamp}-dup`, termsAccepted: true,
    });
    expect(second.id).toBe(booking.id);
    await svc.booking.confirmBooking(user.id, booking.id);
    await svc.booking.confirmBooking(user.id, booking.id);
    expect(await prisma.paymentIntent.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.travelBooking.count({ where: { userId: user.id } })).toBe(1);
  }, 120_000);

  it("FIN-06: failed wallet settlement never reaches the provider", async () => {
    const { user } = await createUser("nofunds");
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
    const { booking } = await bookingFor(user.id, `travel-${stamp}-nofunds`);
    let threw = false;
    try { await svc.booking.confirmBooking(user.id, booking.id); } catch { threw = true; }
    expect(threw).toBe(true);
    const row = await prisma.travelBooking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.providerRef).toBeNull();
    expect(await prisma.paymentIntent.count({ where: { userId: user.id } })).toBe(0);
  }, 120_000);

  it("FIN-07: confirmed travel bookings are counted once in insights", async () => {
    const { user } = await createUser("insights");
    await fund(user.id);
    const { booking } = await bookingFor(user.id, `travel-${stamp}-insights`);
    await svc.booking.confirmBooking(user.id, booking.id);
    const classified = await svc.insights.loadClassifiedTransactions(user.id, new Date(Date.now() - 86_400_000), new Date());
    const travelRecords = classified.records.filter((r: { sourceType: string }) => r.sourceType === "TRAVEL_BOOKING");
    expect(travelRecords.length).toBe(1);
    const settled = await prisma.travelBooking.findUniqueOrThrow({ where: { id: booking.id } });
    const duplicates = classified.records.filter((r: { sourceType: string; paymentRef: string | null }) =>
      r.sourceType === "TRANSACTION" && r.paymentRef === settled.paymentRef);
    expect(duplicates.length).toBe(0);
  }, 120_000);

  it("TRP-08: trips, timezone-aware itinerary, budget and expenses", async () => {
    const { user } = await createUser("trip");
    const trip = await svc.trip.createTrip(user.id, { name: "Diwali trip", destination: "Delhi" });
    const item = await svc.trip.addItineraryItem(user.id, trip.id, {
      category: "FLIGHT", title: "Test flight", startAt: "2026-11-20T10:30:00.000Z",
      startTimeZone: "Asia/Kolkata",
    });
    expect(item.localStart).toContain("04:00 pm");
    await svc.trip.setBudget(user.id, trip.id, { amountMinor: 20_000_00, currency: "INR", categories: ["FLIGHT"] });
    await svc.trip.addExpense(user.id, trip.id, { category: "FLIGHT", amountMinor: 5_000_00, status: "CONFIRMED" });
    const budget = await svc.trip.getBudget(user.id, trip.id);
    expect(budget.spentMinor).toBe(5_000_00);
    expect(budget.remainingMinor).toBe(15_000_00);
  }, 120_000);

  it("SEC-09: bookings and documents are isolated between customers", async () => {
    const [a, b] = await Promise.all([createUser("seca"), createUser("secb")]);
    await fund(a.user.id);
    const { booking } = await bookingFor(a.user.id, `travel-${stamp}-sec`);
    await expectApiError(svc.booking.getBooking(b.user.id, booking.id), 404);
    const bytes = Buffer.from("%PDF-1.4 test ticket");
    const doc = await svc.document.uploadDocument(a.user.id,
      { bytes, fileName: "ticket.pdf", contentType: "application/pdf" },
      { bookingId: booking.id, kind: "TICKET" });
    const link = await svc.document.getDocumentLink(a.user.id, doc.id);
    const downloaded = await svc.document.downloadDocument(a.user.id, doc.id, link.token, link.expiresAt);
    expect(downloaded.buffer.subarray(0, 4).toString()).toBe("%PDF");
    await expectApiError(svc.document.getDocumentLink(b.user.id, doc.id), 404);
  }, 120_000);

  it("CAN-10: cancellations never claim an unconfirmed refund", async () => {
    const { user } = await createUser("cancel");
    await fund(user.id);
    const { booking } = await bookingFor(user.id, `travel-${stamp}-cancel`);
    await svc.booking.confirmBooking(user.id, booking.id);
    const result = await svc.booking.cancelBooking(user.id, booking.id, {
      reason: "Test cancellation of sandbox booking", idempotencyKey: `cancel-${stamp}`,
    });
    expect(result.status).toBe("REFUND_PENDING");
    const refunds = await prisma.travelRefund.findMany({ where: { bookingId: booking.id } });
    expect(refunds.every((r: { status: string }) => r.status !== "REFUNDED")).toBe(true);
    expect(await prisma.travelReconciliationCase.count({ where: { bookingId: booking.id, status: "OPEN" } })).toBeGreaterThan(0);
  }, 120_000);

  it("OPS-11: unsigned webhooks are rejected and Control reports real state", async () => {
    const provider = await prisma.travelProvider.findFirstOrThrow({ where: { status: "AVAILABLE" } });
    const rejected = await svc.webhook.receiveTravelWebhook(provider.code, {
      eventType: "BOOKING_CONFIRMED", eventId: `bad-${stamp}`, signature: "invalidsignature",
      timestamp: "1700000000", payload: { providerRef: "missing" },
    });
    expect(rejected.status).toBe("FAILED");
    const view = await svc.control.getTravelOperations();
    expect(view.providers).toBeGreaterThan(0);
    expect(typeof view.unknownOutcomes).toBe("number");
  }, 120_000);
});
