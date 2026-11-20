import type { TravelCategory } from "@nexus/database";

export interface TravelCapabilities {
  flights: boolean;
  trains: boolean;
  buses: boolean;
  hotels: boolean;
  cabs: boolean;
  airportTransfers: boolean;
  localMobility: boolean;
  search: boolean;
  priceRevalidation: boolean;
  booking: boolean;
  tickets: boolean;
  cancellation: boolean;
  refunds: boolean;
  webhooks: boolean;
}

export interface TravelSearchInput {
  category: TravelCategory;
  origin?: string;
  destination: string;
  departureDate?: string;
  returnDate?: string;
  passengers: number;
  cabinClass?: string;
  checkOut?: string;
}

export interface TravelOfferData {
  code: string;
  name: string;
  category: TravelCategory;
  summary: string;
  amountMinor: number;
  currency: string;
  details: Record<string, unknown>;
  fareRules?: string;
  cancellationRules?: string;
  refundable?: boolean;
  validUntil?: Date;
  retrievedAt: Date;
}

export interface TravelBookingData {
  providerRef: string;
  status: string;
  acceptedAt?: Date;
}

export interface TravelTicketData {
  providerRef: string;
  ticketNumber: string;
  status: string;
  issuedAt: Date;
}

export interface TravelCancellationData {
  providerRef: string;
  status: string;
  chargesMinor?: number;
  estimatedRefundMinor?: number;
}

export interface TravelRefundData {
  providerRef: string;
  status: string;
  amountMinor: number;
}

export interface TravelAdapter {
  readonly code: string;
  readonly displayName: string;
  readonly mode: "SANDBOX" | "PRODUCTION";
  readonly capabilities: TravelCapabilities;
  getProviderDetails(): { name: string; mode: string; capabilities: TravelCapabilities };
  getCapabilities(): TravelCapabilities;
  getCategories(): TravelCategory[];
  searchAvailability(input: TravelSearchInput): Promise<TravelOfferData[]>;
  getProductDetails(code: string): Promise<TravelOfferData | null>;
  getFareRules(code: string): Promise<string | null>;
  getCancellationRules(code: string): Promise<string | null>;
  revalidatePrice(code: string, providerRef?: string): Promise<TravelOfferData | null>;
  createBooking(input: {
    productCode: string; providerRequestRef: string; passengers: Array<{ firstName: string; lastName: string }>; amountMinor: number;
  }): Promise<TravelBookingData | null>;
  getBookingStatus(providerRef: string): Promise<TravelBookingData | null>;
  getBookingDetails(providerRef: string): Promise<TravelOfferData | null>;
  cancelBooking(providerRef: string, reason: string): Promise<TravelCancellationData | null>;
  getCancellationStatus(providerRef: string): Promise<TravelCancellationData | null>;
  getRefundStatus(providerRef: string): Promise<TravelRefundData | null>;
  retrieveTicket(providerRef: string): Promise<TravelTicketData | null>;
  verifyWebhook(input: { signature: string; timestamp: string; rawBody: string }): boolean;
}
