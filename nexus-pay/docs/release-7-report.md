# Nexus Pay — Release 7 Implementation Report (Subscriptions & Recurring Billing)

> Note: the release specification was truncated mid-section 13. This report covers
> sections 1–13 in full plus the notification, testing, documentation and quality-gate
> work implied by the platform's established release pattern.

## Features implemented

Merchant subscription plans (draft/active/archived, trials, intro pricing, setup fees,
custom intervals), public shareable subscription checkout with explicit sandbox
authorization, subscription lifecycle state machine with append-only event history,
durable PostgreSQL-backed recurring billing engine with atomic claims and per-period
idempotency, invoices with atomic merchant-scoped numbering and PDF documents,
dunning/failure classification with configured retry windows, customer self-service
portal with cancellation, plan upgrades/downgrades effective at the next period with
recorded direction, revenue recovery dashboard, recurring revenue analytics with
documented metric definitions, subscription lifecycle webhook events, and Nexus
Control subscription/billing monitoring.

## Architecture changes

- New `lib/subscription/` module: `billing-calendar`, `plan-service`,
  `subscription-core`, `subscription-service`, `billing-engine`, `billing-worker`,
  `invoice-service`, `subscription-analytics`.
- `instrumentation.ts` now starts the billing worker alongside the scheduled-payment
  and webhook workers.
- Raftline remains authoritative for money. PostgreSQL stores plans, pricing
  snapshots, subscriptions, lifecycle events, billing occurrences, invoices and
  dunning state — orchestration metadata only.

## Database migrations

- `20261118044405_release7_subscriptions` (plans, subscriptions, events, billing
  occurrences, invoices, line items, invoice-number sequences, plan changes,
  notification types).
- `20261118055606_release7_plan_change_direction` (explicit UPGRADE/DOWNGRADE/
  SIDEWAYS direction on plan-change history).

## New API endpoints

Merchant: `/api/merchant/plans`, `/api/merchant/plans/[id]`,
`/api/merchant/plans/[id]/status`, `/api/merchant/subscriptions` (+ `[id]`, pause,
resume, cancel, plan-change, events, occurrences), `/api/merchant/invoices`
(+ `[id]`, pdf, void), `/api/merchant/billing/analytics`,
`/api/merchant/billing/recovery`, `/api/merchant/billing/run`.

Public/customer: `/api/subscribe/[token]` (+ `/confirm`), `/api/subscriptions`
(+ `[id]`, events, occurrences, cancel, invoices), `/api/invoices`,
`/api/invoices/[id]/pdf`.

Nexus Control: `/api/control/subscriptions`, `/api/control/billing-metrics`,
`/api/control/subscription-invoices` (read-only, `payments:read` RBAC).

## Raftline capabilities integrated

Account create/lookup, balance reads and `INTERNAL_BOOK` settlement via the existing
adapter. **No mandate, recurring collection, refund or reversal capability exists in
Raftline** (verified from `RaftHttpServer` and the settlement engine). Every renewal
is therefore a separate explicitly-authorized wallet settlement.

## Recurring payment authorization

The sandbox does not establish a legally valid bank mandate or UPI AutoPay. Customers
accept a recurring-billing arrangement at checkout; each occurrence is settled as a
new Nexus Pay wallet payment. Uncertain outcomes are reconciled against Raftline's
transaction lookup using the original payment intent before any further attempt.

## Financial integrity

- One `BillingOccurrence` per subscription period enforced by a unique constraint on
  `(subscriptionId, occurrenceNumber)` and a unique idempotency key. Concurrency is
  tested by processing one occurrence from two parallel workers: exactly one settles.
- The occurrence idempotency key is stable and never regenerated. A confirmed
  rejection gets a deterministic per-attempt request id on a later dunning retry;
  an uncertain outcome always reuses the exact original request id.
- Invoice amounts are integer paise snapshots frozen at subscription creation; plan
  edits and plan changes never rewrite historical invoices.
- Durable leases plus atomic `updateMany` claims prevent two workers from executing
  the same occurrence concurrently.

## Known limitations

- No real UPI AutoPay/bank mandate/card-on-file; sandbox INR only.
- No proration: plan changes take effect at the next billing period.
- Dunning delays are fixed default windows (1/3/5 days), not per-merchant configurable.
- Invoice PDFs are sandbox documents with no tax-registration claims.
- Developer API key scopes for subscriptions were not part of the received
  (truncated) specification; merchant dashboard APIs are session-authenticated.

## Verification

| Gate | Result |
| --- | --- |
| typecheck / lint / build | Passed |
| unit | 61 passed (8 new calendar tests) |
| integration | 68 passed (12 new live billing tests) |
| E2E | 10 passed (2 new subscription/Control smokes) |

## Commands

```powershell
cd C:\Sushrut\projects\nexus-pay
pnpm dev
pnpm test:unit
pnpm test:integration
pnpm exec playwright test --config playwright.prod.config.ts
```

