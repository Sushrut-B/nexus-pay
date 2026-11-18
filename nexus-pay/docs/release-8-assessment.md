# Release 8 — Rewards, Cashback, Loyalty & Offers: Implementation Assessment

## Existing releases verified

Releases 1–7 are present and green (61 unit, 68 integration, 10 E2E). Customer
auth, wallets, Raftline settlement, merchant platform, subscriptions, durable
workers (scheduled payments, webhooks, billing), notification infrastructure and
Nexus Control RBAC/audit are reusable. Working source: `C:\Sushrut\projects\nexus-pay`.

## Raftline capabilities verified

`RaftHttpServer` exposes `settle`, `authorize`, `capture`, `void`, `seed` (used by
`fundAccount`), `accounts`, `account`, `transactions`, `idempotency`. There is
**no refund/reversal, mandate, or external loyalty integration**.

## Reuse plan

- **Cashback credit:** reuse `getOrCreateFundingOperation` + `executeFundingOperation`.
  It uses a stable idempotency key, credits via Raftline `fundAccount`, and verifies
  a committed receipt before `COMPLETED`. All cashback will be labelled as a
  **sandbox promotional credit**, never real money.
- **Points:** new append-only ledger in PostgreSQL; points are NOT wallet money and
  have no INR value. No conversion mechanism is introduced.
- **Workers:** extend the existing process-global worker bootstrap in
  `instrumentation.ts` with one unified rewards worker using atomic claims/leases.
- **Notifications:** extend NOTIFICATION_TYPES; deduplicate via a unique reward
  notification event key.
- **Admin:** reuse Nexus Control RBAC (`/api/control/**`, not `/api/admin/**`) and
  `recordAdminAudit` for all privileged actions.
- **Checkout:** reuse merchant checkout/payment-link confirmation paths for promo
  validation, with server-calculated discounts and atomic reservation consumption.

## Financial & security risks

1. Points and cashback must never be displayed as one balance.
2. Cashback credits must reuse the entitlement's stable idempotency key and never be
   retried with a new key after a timeout.
3. Budget/redemption/promo capacity must be reserved atomically to prevent overspend.
4. Merchant isolation and customer ownership enforced on every endpoint.
5. No fabricated metrics; all views derive from persisted records.
6. Manual adjustments never touch wallet funds; no manual "cashback succeeded".
