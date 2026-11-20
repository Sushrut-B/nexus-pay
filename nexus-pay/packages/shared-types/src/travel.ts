/** Release 15 — Travel, mobility & ticketing transport contracts. */

export const TRAVEL_CATEGORIES = [
  "FLIGHT", "TRAIN", "BUS", "HOTEL", "CAB", "AIRPORT_TRANSFER", "LOCAL_MOBILITY",
] as const;
export type TravelCategory = (typeof TRAVEL_CATEGORIES)[number];

export const TRAVEL_BOOKING_STATUSES = [
  "DRAFT", "VALIDATION_PENDING", "READY_FOR_PAYMENT", "PAYMENT_PENDING",
  "PAYMENT_SETTLED", "PROVIDER_SUBMISSION_PENDING", "PROVIDER_PROCESSING",
  "CONFIRMED", "FAILED", "UNKNOWN", "RECONCILIATION_REQUIRED", "CANCELLATION_PENDING", "CANCELLED",
  "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED", "COMPLETED",
] as const;
export type TravelBookingStatus = (typeof TRAVEL_BOOKING_STATUSES)[number];

export interface TravelProviderView {
  id: string; code: string; displayName: string; mode: string; status: string;
  capabilities: Record<string, boolean>; available: boolean; notice: string;
  categories: string[]; lastSyncAt: string | null;
}

export interface TravelSearchResultView {
  id: string; productId: string | null; name: string; category: TravelCategory;
  amountMinor: number | null; currency: string; details: Record<string, unknown>;
  source: string; retrievedAt: string; expiresAt: string | null; isSandbox: boolean;
}

export interface TravelSearchView {
  id: string; category: TravelCategory; status: string; providerCode: string;
  createdAt: string; expiresAt: string | null; results: TravelSearchResultView[];
  notice: string;
}

export interface TravelBookingView {
  id: string; reference: string; category: TravelCategory; providerName: string;
  amountMinor: number; currency: string; status: TravelBookingStatus;
  paymentRef: string | null; providerRef: string | null; confirmedAt: string | null;
  createdAt: string; isSandbox: boolean; passengerCount: number; notice: string;
}

export interface TravelTicketView {
  id: string; providerRef: string; ticketNumber: string | null; status: string;
  issuedAt: string | null; fileName: string | null; hasDocument: boolean;
}

export interface TravelCancellationView {
  id: string; providerRef: string | null; status: string; chargesMinor: number;
  estimatedRefundMinor: number | null; confirmedAt: string | null; createdAt: string;
  notice: string;
}

export interface TravelRefundView {
  id: string; providerRef: string; amountMinor: number; status: string;
  confirmedAt: string | null; createdAt: string;
}

export interface TravelTripView {
  id: string; name: string; destination: string | null;
  startDate: string | null; endDate: string | null; status: string;
  bookingCount: number; note: string | null;
}

export interface TravelItineraryViewItem {
  id: string; bookingId: string | null; category: TravelCategory; title: string;
  startAt: string; endAt: string | null; startTimeZone: string;
  localStart: string; location: string | null;
}

export interface TravelExpenseView {
  id: string; category: string; amountMinor: number; currency: string;
  status: string; description: string | null; occurredAt: string;
}

export interface TravelBudgetView {
  amountMinor: number; currency: string; spentMinor: number; remainingMinor: number;
  categories: string[];
}

export interface TravelOperationsView {
  providers: number; availableProviders: number; searches: number; bookings: number;
  confirmedBookings: number; unknownOutcomes: number; reconciliationCases: number;
  lastSyncAt: string | null; currency: string;
}
