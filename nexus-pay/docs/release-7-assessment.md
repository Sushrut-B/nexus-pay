# Release 7 — Subscriptions & Recurring Billing: Implementation Assessment

## Releases 1–6 verified as present

Customer auth/sessions, wallet provisioning, Raftline settlement adapter, idempotent
payment intents, transaction history, merchant accounts/orders/checkout/payments,
refund request+review, merchant analytics, notifications, HMAC webhooks with a durable
outbox + worker, scoped developer APIs and Nexus Control RBAC/audit are implemented.
All Release 6 gates pass (53 unit, 56 integration, 8 E2E). Working source is
`C:\Sushrut\projects\nexus-pay`; git remote work happens in `C:\Sushrut\projects\Raftline`.

## Raftline capabilities verified from source

`RaftHttpServer.createContext` exposes only:

- `/v1/payments/settle` — `INTERNAL_BOOK` settlement, idempotency key, committed receipt.
- `/v1/payments/accounts`, `/v1/payments/account` — account create/lookup and balance read.
- `/v1/payments/transactions` — transaction lookup by reference.

**No refund/reversal, no mandate, no recurring/card-on-file, no external gateway.**
(The `WebhookSubscription` class in Raftline is its internal CDC dispatcher, unrelated
to Nexus Pay merchant webhooks.) All recurring money movement must therefore reuse
the existing verified payment engine; each renewal requires explicit sandbox
authorization semantics and a deterministic idempotency key.

## Reuse plan

- **Scheduling:** extend the existing durable PostgreSQL job-worker pattern used by
  `lib/finance/schedule-worker.ts` (atomic claim, lease, bounded retry) — never browser timers.
- **Payment:** reuse `getOrCreatePaymentIntent` + `executePaymentIntent`; derive a stable
  per-occurrence idempotency key so a worker restart cannot double-debit.
- **Documents:** reuse `pdf-lib` (already used by `lib/finance/statement-service.ts`) for PDF invoices.
- **Notifications:** extend `createNotification` with subscription event types.
- **Merchant plumbing:** reuse merchant api-guard, CSRF/rate-limit helpers, `jsonOk` envelope.
- **Webhooks:** reuse the merchant outbox (`createWebhookEvent`) for subscription lifecycle events.

## New authoritative boundaries

Raftline remains the only financial ledger. PostgreSQL stores plan definitions,
pricing snapshots, subscriptions, immutable lifecycle events, billing occurrences,
invoices and dunning state — all metadata/orchestration, never balances.

## Key safety rules

1. One billing occurrence per subscription period, enforced by a unique DB constraint.
2. Idempotency key fixed at occurrence creation; never regenerated on timeout.
3. Uncertain settlements stay unresolved and are reconciled via transaction lookup before retry.
4. Invoice amounts frozen as integer paise snapshots; plan edits never rewrite history.
5. Merchant and customer ownership enforced on every query.
6. No fake mandates, no real UPI/card claims, no manual balance adjustments.
