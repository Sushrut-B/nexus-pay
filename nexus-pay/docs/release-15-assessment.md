# Release 15 — Travel, Mobility & Smart Ticketing: Audit & Implementation Plan

## Phase 0 — Verification

Baseline commit `aef8aee` (`feat(nexus-pay): Release 14 bill payments, recharges and household management`) contains Releases 1–14. A detailed reusable-component inventory is recorded in `docs/travel-reuse-inventory.md`.

## Regulatory research (official sources)

Sources reviewed: IRCTC's Rules & Regulations for Reserved Rail e-Ticketing Service Providers, B2B PSP norms, and the **B2C Principal Service Provider Policy Edition 2025 v3.0** (effective 20-09-2025). Key findings:

- IRCTC reserved e-ticketing APIs are shared **only with registered Principal Service Providers (PSPs)** after administrative formalities, integration charges (₹20 lakh), AMC, security deposit and CERT-In security audit. Affiliates/associates require prior IRCTC approval and separate registration fees.
- There is **no public IRCTC booking API**. Nexus Pay has no PSP registration, authorisation or agreement. Therefore: **no IRCTC partnership claim, no automated IRCTC interaction, no IRCTC credentials collected**, and no real train inventory or fare invented.
- Airlines, hotels, bus operators, metro and mobility providers likewise require documented API access and authorisation. Nexus Pay has no verified integrations.

The only configured path will be an environment-gated, clearly labelled **sandbox demonstration provider** whose search results, prices, bookings and tickets are test fixtures. Production prerequisites are documented.

## Financial boundaries

- Raftline remains authoritative for wallet balances and committed settlements; no second ledger.
- Booking provider status and wallet settlement status are separate records. A wallet debit never establishes a confirmed ticket, room or seat.
- Booking orchestration mirrors the Release 14 two-system pattern: call the existing payment engine with a stable idempotency key, record the Raftline `paymentRef`, then submit to the provider and record its `providerRef`; only provider confirmation yields `CONFIRMED`/`TICKET_ISSUED`.
- Unknown outcomes reconcile with the original references; no second debit, no fabricated refund.

## Implementation plan

1. Provider abstraction + env-gated sandbox + unavailable states + category capabilities.
2. Prisma schema (providers, searches/snapshots, price snapshots, bookings/attempts/history, passengers, tickets, cancellations/refunds, webhooks/sync, trips/itinerary/documents/budgets/expenses, reconciliation).
3. Services: discovery/search, fare revalidation, two-system booking orchestration, cancellations/refunds, trips/itineraries, expenses, fraud events, Control and worker.
4. Customer APIs/UI and Control Travel Operations.
5. Unit/integration/financial-safety/security/E2E tests, docs, full verification gates.

## Safety rules

- Search result ≠ revalidated fare ≠ confirmed booking ≠ issued ticket.
- Estimate ≠ confirmed price; refund pending ≠ refund completed.
- Passenger identity data minimized, encrypted and masked; no passport/OTP/payment credentials stored unnecessarily.
