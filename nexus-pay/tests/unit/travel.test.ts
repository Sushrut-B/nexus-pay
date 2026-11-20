import { describe, expect, it } from "vitest";
import { TRAVEL_BOOKING_TRANSITIONS, bookingView } from "../../apps/web/lib/travel/booking-service";
import { SandboxTravelAdapter, SANDBOX_TRAVEL_NOTICE } from "../../apps/web/lib/travel/providers/sandbox-travel";
import { formatLocalDateTime, isValidTimeZone } from "../../apps/web/lib/travel/itinerary";
import { travelCollectionUsername } from "../../apps/web/lib/travel/collection-account";

describe("travel booking lifecycle", () => {
  it("keeps wallet settlement separate from provider confirmation", () => {
    expect(TRAVEL_BOOKING_TRANSITIONS.PAYMENT_SETTLED).toContain("PROVIDER_SUBMISSION_PENDING");
    expect(TRAVEL_BOOKING_TRANSITIONS.PAYMENT_SETTLED).not.toContain("CONFIRMED");
    expect(TRAVEL_BOOKING_TRANSITIONS.PROVIDER_PROCESSING).toContain("CONFIRMED");
    expect(TRAVEL_BOOKING_TRANSITIONS.CONFIRMED).toContain("CANCELLATION_PENDING");
  });

  it("routes failure and unknown outcomes away from a second debit", () => {
    expect(TRAVEL_BOOKING_TRANSITIONS.PAYMENT_PENDING).toContain("FAILED");
    expect(TRAVEL_BOOKING_TRANSITIONS.PAYMENT_PENDING).toContain("UNKNOWN");
    expect(TRAVEL_BOOKING_TRANSITIONS.FAILED).toEqual([]);
    expect(TRAVEL_BOOKING_TRANSITIONS.UNKNOWN).toContain("RECONCILIATION_REQUIRED");
  });

  it("never marks a refund complete without confirmation", () => {
    expect(TRAVEL_BOOKING_TRANSITIONS.REFUND_PENDING).toContain("PARTIALLY_REFUNDED");
    expect(TRAVEL_BOOKING_TRANSITIONS.REFUND_PENDING).toContain("RECONCILIATION_REQUIRED");
    expect(TRAVEL_BOOKING_TRANSITIONS.REFUNDED).toEqual(["COMPLETED"]);
  });

  it(" exposes distinct customer-facing stage labels", () => {
    const base = {
      id: "b1", reference: "ref", category: "FLIGHT" as const, amountMinor: 100,
      currency: "INR", paymentRef: null, providerRef: null, confirmedAt: null,
      createdAt: new Date(), provider: { displayName: "Provider" }, passengers: [],
    };
    expect(bookingView({ ...base, status: "PAYMENT_SETTLED" } as never).notice).toBe("Wallet debit confirmed");
    expect(bookingView({ ...base, status: "CONFIRMED" } as never).notice).toBe("Booking confirmed");
    expect(bookingView({ ...base, status: "UNKNOWN" } as never).notice).toBe("Outcome unknown");
  });
});

describe("sandbox travel provider", () => {
  const adapter = new SandboxTravelAdapter();

  it("is clearly labelled and claims no partnerships", () => {
    expect(adapter.mode).toBe("SANDBOX");
    expect(adapter.code).toBe("sandbox-travel");
    expect(SANDBOX_TRAVEL_NOTICE.toLowerCase()).toContain("no airline");
    expect(SANDBOX_TRAVEL_NOTICE.toLowerCase()).toContain("not real travel");
    expect(adapter.capabilities.refunds).toBe(false);
  });

  it("normalizes provider search results with provenance and validity", async () => {
    const results = await adapter.searchAvailability({
      category: "FLIGHT", destination: "DEL", passengers: 1,
    });
    expect(results.length).toBeGreaterThan(0);
    const offer = results[0]!;
    expect(Number.isInteger(offer.amountMinor)).toBe(true);
    expect(offer.validUntil).toBeInstanceOf(Date);
    expect(offer.details.test).toBe(true);
    expect(JSON.stringify(offer)).toContain("SANDBOX DEMONSTRATION ONLY");
  });

  it("revalidates a price without claiming a booking", async () => {
    const offer = await adapter.revalidatePrice("test-product");
    expect(offer?.amountMinor).toBeGreaterThan(0);
    expect(offer?.validUntil).toBeInstanceOf(Date);
  });

  it("does not fabricate refunds", async () => {
    expect(await adapter.getRefundStatus("any-ref")).toBeNull();
  });

  it("creates deterministic, safe collection usernames", () => {
    const username = travelCollectionUsername("sandbox-travel");
    expect(username).toMatch(/^tv_[a-f0-9]{8}$/);
    expect(username.length).toBeLessThanOrEqual(24);
  });
});

describe("itinerary timezone handling", () => {
  it("formats an instant in the provider's local zone", () => {
    const iso = "2026-11-20T10:30:00.000Z";
    const kolkata = formatLocalDateTime(iso, "Asia/Kolkata");
    const utc = formatLocalDateTime(iso, "UTC");
    expect(kolkata).toContain("04:00 pm");
    expect(utc).toContain("10:30 am");
    expect(kolkata).not.toBe(utc);
  });

  it("rejects invalid time zones gracefully", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(formatLocalDateTime("2026-11-20T10:30:00.000Z", "Not/AZone")).toBe("2026-11-20T10:30:00.000Z");
  });
});
