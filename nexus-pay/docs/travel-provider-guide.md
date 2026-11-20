# Travel Provider Adapter & Onboarding Guide

## Regulatory context

Official sources reviewed: IRCTC's Rules & Regulations for Reserved Rail e-Ticketing Service Providers and the **B2C Principal Service Provider Policy Edition 2025 v3.0** (effective 20-09-2025). IRCTC e-ticketing APIs are provided only to registered PSPs after integration charges, AMC, security deposit and CERT-In audit; no public booking API exists. Affiliates require prior IRCTC approval. Nexus Pay has no such authorisation, so no IRCTC integration or partnership is claimed and no IRCTC credentials are collected. Airline, hotel, bus and mobility integrations likewise require documented API access.

## Adapter interface

`TravelAdapter` (`apps/web/lib/travel/travel-adapter.ts`) declares `code`, `displayName`, `mode`, `capabilities` and methods: `getProviderDetails`, `getCapabilities`, `getCategories`, `searchAvailability`, `getProductDetails`, `getFareRules`, `getCancellationRules`, `revalidatePrice`, `createBooking`, `getBookingStatus`, `getBookingDetails`, `cancelBooking`, `getCancellationStatus`, `getRefundStatus`, `retrieveTicket`, `verifyWebhook`.

Unsupported operations must be declared false and callers check them. All amounts are integer minor units. Fares carry `validUntil`; bookings carry provider references.

## Adding a provider

1. Implement `TravelAdapter` in `lib/travel/providers/`.
2. Register it in `lib/travel/providers/index.ts` and its env gate.
3. Store credentials in environment/secret management; never in frontend code.
4. Complete commercial, technical, legal and regulatory prerequisites before enabling production.

## Webhooks

`POST /api/travel/webhooks/:providerCode` verifies HMAC-SHA256 signatures over `${timestamp}.${JSON.stringify(payload)}`, deduplicates by `(providerId, eventId)` and processes asynchronously via `TravelProviderSync`. Unsigned callbacks are rejected. Where webhooks are unavailable, documented status APIs and controlled polling are used.

## Status

| Capability | Status |
| --- | --- |
| Adapter, search, revalidation, booking, tickets, trips, expenses, Control | Implemented |
| Sandbox provider (`sandbox-travel`) | Sandbox only (`NEXUS_TRAVEL_SANDBOX_ENABLED=true`) |
| Real IRCTC/airline/hotel/bus/mobility providers | Not connected |
| Refunds, reschedules, passenger changes, live status | Architecture-ready, not connected |
