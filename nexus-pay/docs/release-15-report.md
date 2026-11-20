# Release 15 — Travel, Mobility & Smart Ticketing: Implementation Report

## 1. Implementation summary

Release 15 adds travel discovery and booking infrastructure: a category-aware provider adapter with an env-gated sandbox, search with snapshots and fare revalidation, a two-system booking state machine linking Raftline settlement to provider confirmation, tickets and documents, cancellations/refunds with honest refund states, trips with timezone-aware itineraries, budgets and expenses, fraud event publication, and Nexus Control Travel Operations. No real provider is connected and no fabricated inventory, fare, booking, ticket or refund is presented as real.

## 2. Existing modules reused

Existing payment engine `getOrCreatePaymentIntent`/`executePaymentIntent` (merchant/billing integration pattern); Raftline client; transactional outbox, durable worker claim/lease/backoff/dead-letter and webhook verification; AES-256-GCM encryption and signed links for documents; `createNotification`, fraud `publishSecurityEvent`, Control RBAC/audit, API and UI conventions. Release 12 insurance remains the authoritative source for policy status; no insurance purchase is automated here.

## 3. Database models and migrations

Migrations `20261120065911_release15_travel_mobility` and `20261120071415_release15_reconciliation_status`. 24 new models: providers/capabilities, searches/result snapshots, products/price snapshots, bookings/attempts/passengers/status history, tickets, cancellations, refunds, webhooks/syncs, trips/members/itinerary items, documents, budgets, expenses, saved destinations, notification preferences and reconciliation cases. Extended `NotificationType` and `SecurityEventType`. No payment/transaction table duplicated.

## 4. API endpoints

`/api/travel/{categories,providers,search,search/:id,search/:id/results,products/:id,products/:id/revalidate}`, `/api/travel/bookings` CRUD + confirm/ticket/confirmation/cancel/cancellation/refund, `/api/travel/trips` CRUD + bookings/itinerary/budget/expenses/documents, `/api/travel/documents` + signed download, `/api/travel/destinations`, signed webhooks `/api/travel/webhooks/:providerCode`, and Control `/api/control/travel/{overview,providers,bookings,reconciliation,reconciliation/:id/assign,resolve,run}`.

## 5. Travel provider architecture

`TravelAdapter` declares category capabilities (flights, trains, buses, hotels, cabs, airport transfers, local mobility) plus operation capabilities (search, revalidation, booking, tickets, cancellation, refunds, webhooks). Registry gates adapters by `NEXUS_TRAVEL_SANDBOX_ENABLED`; unavailable providers return 503 with documented prerequisites. Credentials belong in secret management only.

## 6. Actual provider integrations and status

Only `sandbox-travel` is configured, gated by `NEXUS_TRAVEL_SANDBOX_ENABLED`. All results, fares, bookings and tickets are labelled test fixtures. No IRCTC, airline, hotel, bus, metro or mobility partnership is claimed. Refunds and complaints are unsupported by the sandbox. Production onboarding prerequisites are documented.

## 7. Categories genuinely supported

Architecture supports flights, trains, buses, hotels, cabs, airport transfers and local mobility. Because no real provider exists, availability is shown only for the labelled sandbox; unsupported categories return an honest unavailable state. Train booking is explicitly limited by IRCTC PSP authorisation requirements (B2C PSP policy 2025).

## 8. Search and booking workflows

Searches validate category-specific criteria, invoke the provider, persist labelled snapshots with retrieval time and expiry. `revalidateResult` fetches a fresh fare with validUntil before a booking can be created; `createBooking` refuses stale searches/expired fares. `confirmBooking` runs the durable lifecycle: PAYMENT_PENDING → PAYMENT_SETTLED → PROVIDER_SUBMISSION_PENDING → PROVIDER_PROCESSING → CONFIRMED, with ticket retrieval on provider confirmation.

## 9. Payment orchestration and reconciliation

The existing engine is called with a stable idempotency key and a server-resolved recipient. Wallet REJECTED ⇒ FAILED with no provider call; UNKNOWN ⇒ reconciliation case with no second debit; SETTLED ⇒ provider submission only afterwards. Provider failure after settlement preserves the settlement and opens a reconciliation case. Duplicate requests return the existing booking and intent. No balance or ledger mutation by the travel module.

## 10. Cancellation and refund functionality

Cancellation requires explicit confirmation and provider support; cancellation state uses the documented lifecycle. The sandbox reports no confirmed refund, so cancellation transitions to REFUND_PENDING with a reconciliation case — never REFUNDED. Refunds are only marked complete from provider confirmation.

## 11. Trip and itinerary management

Trips with roles, timezone-aware itinerary items (absolute UTC instant plus IANA zone, rendered via `Intl.DateTimeFormat`), booking associations and secure document storage with signed short-lived links.

## 12. Travel expense integration

Confirmed bookings are counted once in financial insights via a `travelRefs` skip set that suppresses the engine's duplicate P2P `TransactionRecord`; only provider-confirmed bookings count as travel spending. Per-trip budgets and expenses distinguish estimated, pending, confirmed, refunded and cancelled amounts.

## 13. Fraud intelligence integration

Events flow through the existing outbox: search created, booking initiated/confirmed/failed, cancellation requested, refund requested, passenger details changed and unusual booking attempt. No separate risk engine; risk decisions never alter balances or cancel confirmed bookings.

## 14. Nexus Control additions

Travel Operations with provider/booking monitoring and reconciliation queue with audited assign/resolve, read-only by default. Added `travel:read/write` permissions; operators cannot modify balances, fabricate confirmations/tickets/refunds or regenerate idempotency keys.

## 15. Background workers and webhook handlers

`startTravelWorker()` in `instrumentation.ts`: search expiry, signed webhook verification/dedupe/async processing, and deduplicated departure reminders. Claim/lease/backoff/dead-letter with correlation IDs.

## 16. Security and privacy safeguards

Passenger identifiers encrypted and masked, ownership checks on bookings/documents/trips, RBAC/CSRF/rate limits, signed webhooks, signed document links, no passport/OTP/payment credentials collected, append-only audit events.

## 17. Tests executed and results

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — pass.
- `pnpm test:unit` — 128 passed (11 new travel unit tests).
- `pnpm test:integration` — pass (11 new travel integration tests including financial-safety and isolation tests).
- `pnpm test:e2e` — pass against a production build (3 new travel scenarios).

## 18. Environment variables and Windows setup

`NEXUS_TRAVEL_SANDBOX_ENABLED` (false), `NEXUS_TRAVEL_SEARCH_TTL_MINUTES` (30). Windows: `pnpm install`, `pnpm --filter @nexus/database db:generate`, `prisma migrate deploy`, `pnpm dev`.

## 19. Known limitations and unfinished items

Sandbox-only; no real availability, fares, tickets or refunds. Refunds, date/passenger changes and live mobility status are architecture-ready but not connected. No real-time metro/flight status, no automated insurance purchase, and no live driver locations. Timezone rendering uses stored IANA zones, not a live timezone database service.

## 20. Confirmation

Releases 1–14 were not rewritten. Changes are additive: new services/models/routes/UI/enums/permissions/worker plus a travel-specific de-duplication rule in financial insights. All existing unit, integration and E2E suites still pass. Release 16 was not started.
