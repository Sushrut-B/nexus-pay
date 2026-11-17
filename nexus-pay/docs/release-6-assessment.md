# Release 6 — Nexus Pay Merchant Ecosystem: Implementation Assessment

## Existing architecture verified

Releases 1–5 are present and green (53 unit, 46 integration, 7 E2E tests). Customer auth,
wallet provisioning, Raftline settlement, idempotent payment intents, transaction history,
notifications, insights and Nexus Control RBAC are implemented and working.

## Raftline capabilities verified from source

- Account create/lookup/fund: supported.
- Settlement: `POST /v1/payments/settle`, rail `INTERNAL_BOOK`, idempotency key, returns
  payment ref, balances after, raft log index and idempotent replay flag.
- Transaction lookup: `getTransaction(ref)` in the existing API client.
- **Refund / reversal / chargeback: NOT supported.** No endpoint or engine method exists.
  Refunds will therefore be request + review + audited administrative state only. No manual
  balance movement or fake settlement will be used.

## Proposed architecture

- Merchant identity linked to an existing customer User (one user may own both accounts).
- Merchant business wallet mapped to a Raftline account via the existing provisioning flow.
- Merchant database tables store business metadata, orders, links, checkout sessions,
  payment metadata, refund requests, API keys, webhooks and outbox events.
- All money movement delegates to the existing `getOrCreatePaymentIntent` +
  `executePaymentIntent` path; no second ledger.
- Webhooks use a durable outbox and a server-side worker with HMAC-SHA256 signatures;
  delivery never blocks settlement.
- Nexus Control reused for merchant approval/suspension and refund review.

## Constraints

- Sandbox INR only. No UPI/bank/card/external gateway claims.
- Order/link/payment states derive only from verified settlement outcomes.
- Merchant-scoped authorization on every resource; no cross-merchant reads.
