# Nexus Pay — Release 6 Implementation Report (Merchant Ecosystem)

## Features implemented

Merchant onboarding with draft persistence, idempotent business wallet provisioning, Nexus Control sandbox approval, business dashboard with a live Raftline wallet balance, orders with integer-paise calculations, payment links, merchant static **and dynamic** QR (amount fixed server-side), customer checkout, merchant payments via the existing verified settlement engine, refund request/review (execution unavailable), merchant customers, analytics, API keys with scopes, webhook endpoints with HMAC-SHA256 signatures, a durable outbox worker with working exponential-backoff retries and manual retry, a developer portal with delivery history, a developer REST endpoint, merchant settings and Nexus Control merchant operations.

## Architecture changes

Merchant identity is linked to an existing customer user; no duplicate authentication. All money movement delegates to `getOrCreatePaymentIntent` + `executePaymentIntent`. Merchant tables are metadata only. Webhook outbox events are written in the same DB transaction as merchant state but delivered asynchronously.

## Database migrations

- `20261117154058_release6_merchant`
- `20261117154511_release6_notifications`

## New API endpoints

`/api/merchants`, `/api/merchants/me`, `/api/merchants/provision`, `/api/merchants/submit`, `/api/merchant/orders`, `/api/merchant/orders/[orderId]`, `/api/merchant/payment-links`, `/api/merchant/payment-links/[id]`, `/api/checkout/[token]`, `/api/checkout/[token]/confirm`, `/api/checkout/[token]/status`, `/api/merchant/payments`, `/api/merchant/refunds`, `/api/merchant/analytics/overview`, `/api/merchant/webhooks`, `/api/merchant/webhooks/deliveries`, `/api/merchant/webhooks/deliveries/[id]/retry`, `/api/merchant/api-keys`, `/api/merchant/customers`, `/api/merchant/qr/[handle]`, `/api/merchant/qr/link/[token]`, `/api/merchant-qr/[handle]`, `/api/v1/merchant/orders`, `/api/control/merchants`, `/api/control/merchant-refunds`.

## Raftline capabilities integrated

Account create/lookup, live account balance reads and `INTERNAL_BOOK` settlement via the existing adapter. Receipt lookup for merchant payment verification.

## Refund support status

**Unavailable at backend.** Raftline has no refund/reversal endpoint. Nexus Pay records and reviews refund requests with full audit trail and clear "no money moved" status. No simulated refunds.

## Webhook implementation

Transactional outbox, two-phase background worker (fan-out then attempt/retry), HMAC-SHA256 over `timestamp.rawBody` with fresh timestamps per attempt, real exponential-backoff redelivery, dead-letter after 5 attempts, manual retry, delivery history, test events, HTTPS required in production.

## Security

Merchant ownership on every resource, server-derived amounts, unguessable tokens, expiry/limit enforcement, hashed scoped API keys, masked customer contact data, CSRF on mutations, rate limits, audit logs.

## Tests executed

| Gate | Result |
| --- | --- |
| typecheck / lint / build | Passed |
| unit | 53 passed |
| integration | 56 passed (10 new Release 6 live tests) |
| E2E | 8 tests (7 existing + 1 merchant smoke) |

## Known limitations

No refunds; no real UPI/card/bank rails; developer API currently exposes orders; no inventory; no PDF merchant reports; sandbox approval is not KYC.

## Commands

```powershell
cd C:\Sushrut\projects\nexus-pay
pnpm dev   # http://localhost:3000 and /control
pnpm test:unit
pnpm test:integration
pnpm exec playwright test --config playwright.prod.config.ts
```
