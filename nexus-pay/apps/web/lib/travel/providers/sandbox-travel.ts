import { createHash, createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type {
  TravelAdapter, TravelCapabilities, TravelCancellationData, TravelBookingData,
  TravelOfferData, TravelRefundData, TravelSearchInput, TravelTicketData,
} from "@/lib/travel/travel-adapter";

export const SANDBOX_TRAVEL_NOTICE =
  "SANDBOX DEMONSTRATION ONLY — no airline, IRCTC, railway, bus operator, hotel, metro or mobility partnership exists. Search results, fares, bookings and tickets below are test fixtures, not real travel.";

const CAPABILITIES: TravelCapabilities = {
  flights: true, trains: true, buses: true, hotels: true, cabs: true,
  airportTransfers: true, localMobility: true,
  search: true, priceRevalidation: true, booking: true, tickets: true,
  cancellation: true, refunds: false, webhooks: true,
};

function ref(seed: string): string {
  return `trav_${createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

/** Clearly labelled test provider. Enabled only by NEXUS_TRAVEL_SANDBOX_ENABLED. */
export class SandboxTravelAdapter implements TravelAdapter {
  readonly code = "sandbox-travel";
  readonly displayName = "Sandbox Demonstration Travel Provider";
  readonly mode = "SANDBOX" as const;
  readonly capabilities = CAPABILITIES;

  getProviderDetails() { return { name: this.displayName, mode: this.mode, capabilities: this.capabilities }; }
  getCapabilities() { return this.capabilities; }
  getCategories() { return ["FLIGHT", "TRAIN", "BUS", "HOTEL", "CAB", "AIRPORT_TRANSFER", "LOCAL_MOBILITY"] as const as never; }

  async searchAvailability(input: TravelSearchInput): Promise<TravelOfferData[]> {
    const now = new Date();
    const validUntil = new Date(Date.now() + 30 * 60_000);
    const category = input.category;
    const base = {
      currency: "INR", retrievedAt: now, validUntil, refundable: false,
      fareRules: SANDBOX_TRAVEL_NOTICE, cancellationRules: SANDBOX_TRAVEL_NOTICE,
      source: "SANDBOX_FIXTURE",
    };
    const code = ref(`${category}:${input.origin ?? ""}:${input.destination}`);
    const nameByCategory: Record<string, string> = {
      FLIGHT: "Sandbox Airline Test Flight", TRAIN: "Sandbox Railway Test Service",
      BUS: "Sandbox Bus Operator Test Service", HOTEL: "Sandbox Hotel Test Property",
      CAB: "Sandbox Cab Test Service", AIRPORT_TRANSFER: "Sandbox Airport Transfer Test",
      LOCAL_MOBILITY: "Sandbox Local Mobility Test",
    };
    return [
      {
        ...base,
        code: `${code}-1`,
        name: `${nameByCategory[category] ?? "Sandbox Travel Test"} (fixture)`,
        category,
        summary: SANDBOX_TRAVEL_NOTICE,
        amountMinor: 4_500_00,
        details: {
          test: true,
          category,
          origin: input.origin ?? null,
          destination: input.destination,
          departureDate: input.departureDate ?? null,
          returnDate: input.returnDate ?? null,
          passengers: input.passengers,
          notice: SANDBOX_TRAVEL_NOTICE,
        },
      },
    ];
  }

  async getProductDetails(code: string): Promise<TravelOfferData | null> {
    const category = (code.includes("TRAIN") ? "TRAIN" : code.includes("BUS") ? "BUS" : code.includes("HOTEL") ? "HOTEL" : "FLIGHT") as TravelOfferData["category"];
    return {
      code, name: "Sandbox Travel Test Product (fixture)", category,
      summary: SANDBOX_TRAVEL_NOTICE, amountMinor: 4_500_00, currency: "INR",
      details: { test: true, code, notice: SANDBOX_TRAVEL_NOTICE },
      fareRules: SANDBOX_TRAVEL_NOTICE, cancellationRules: SANDBOX_TRAVEL_NOTICE,
      refundable: false, validUntil: new Date(Date.now() + 30 * 60_000), retrievedAt: new Date(),
    };
  }

  async getFareRules() { return SANDBOX_TRAVEL_NOTICE; }
  async getCancellationRules() { return SANDBOX_TRAVEL_NOTICE; }

  async revalidatePrice(code: string): Promise<TravelOfferData | null> {
    const product = await this.getProductDetails(code);
    return product ? { ...product, validUntil: new Date(Date.now() + 30 * 60_000), retrievedAt: new Date() } : null;
  }

  async createBooking(input: { productCode: string; providerRequestRef: string }): Promise<TravelBookingData> {
    return { providerRef: ref(`booking:${input.providerRequestRef}`), status: "ACCEPTED", acceptedAt: new Date() };
  }

  async getBookingStatus(providerRef: string): Promise<TravelBookingData> {
    return { providerRef, status: "CONFIRMED", acceptedAt: new Date() };
  }

  async getBookingDetails(providerRef: string): Promise<TravelOfferData | null> {
    return this.getProductDetails(providerRef);
  }

  async cancelBooking(providerRef: string): Promise<TravelCancellationData> {
    return { providerRef: ref(`cancel:${providerRef}`), status: "CANCELLATION_CONFIRMED", chargesMinor: 0, estimatedRefundMinor: 0 };
  }

  async getCancellationStatus(providerRef: string): Promise<TravelCancellationData> {
    return { providerRef, status: "CANCELLATION_CONFIRMED" };
  }

  // Refunds are unsupported by the sandbox: never fabricate a completed refund.
  async getRefundStatus(): Promise<TravelRefundData | null> { return null; }

  async retrieveTicket(providerRef: string): Promise<TravelTicketData> {
    return {
      providerRef, ticketNumber: `TEST-${providerRef.slice(-6).toUpperCase()}`,
      status: "ISSUED", issuedAt: new Date(),
    };
  }

  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean {
    const expected = createHmac("sha256", getServerEnv().AUTH_SECRET).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
    return expected === input.signature;
  }
}

export { CAPABILITIES as SANDBOX_TRAVEL_CAPABILITIES };
