# Release 14 — Bill Payments & Recharges: Implementation Report

## 1. Implementation summary

Release 14 adds a bill-payment and recharge module: provider abstraction with an env-gated sandbox, biller directory and discovery, saved bill accounts with encrypted identifiers and masking, bill fetch with snapshot validation and expiry checks, a two-system payment state machine that links Raftline wallet settlement to provider confirmation, prepaid recharges, recurring bill detection and reminders, household bill responsibility, Nexus Pay payment records, financial-insights integration, fraud event publication, and a Nexus Control Bill Payments Operations centre. No real biller, bill, plan, payment or confirmation is fabricated, and no BBPS/Bharat Connect participation is claimed.

## 2. Existing modules reused

- Payment engine `getOrCreatePaymentIntent` / `executePaymentIntent` (never rewritten) via the merchant-payment integration pattern: server-side recipient resolution, stable client request ID, one payment intent, one settlement.
- Raftline client and receipt verification; wallet balances always read from Raftline.
- Transactional outbox, durable worker claim/lease/backoff/dead-letter and webhook verification patterns from Releases 10–13.
- AES-256-GCM encryption and signed-link patterns for sensitive account identifiers and receipts.
- `createNotification`, fraud `publishSecurityEvent`, Control RBAC/audit, API response/CSRF/rate-limit conventions, shared UI components.

## 3. Database models and migrations

Migrations: `20261120051530_release14_bill_payments`, `20261120052149_release14_bill_relations`, `20261120052803_release14_recharge_relations`.

28 new models: `BillPaymentProvider`, `BillPaymentProviderCapability`, `BillerCategory`, `Biller`, `BillerParameter`, `BillerCatalogueVersion`, `SavedBillerAccount`, `BillFetchRequest`, `BillSnapshot`, `BillPaymentIntent`, `BillPaymentAttempt`, `BillProviderTransaction`, `BillPaymentStatusHistory`, `RechargePlan`, `RechargePlanSnapshot`, `RechargeIntent`, `RechargeAttempt`, `BillPaymentReceipt`, `RecurringBill`, `BillReminder`, `BillAutoPaymentAuthorization`, `BillReconciliationCase`, `Household`, `HouseholdMember`, `HouseholdBillAssignment`, `BillProviderWebhook`, `BillProviderSync`, `BillPaymentActivity`. Extended `NotificationType` and `SecurityEventType`. No payment, transaction or audit table was duplicated.

## 4. New API endpoints

Biller discovery: `/api/bill-payments/categories`, `/billers`, `/billers/:id`, `/billers/:id/parameters`.
Saved accounts: CRUD `/api/bill-payments/accounts(/:id)`.
Bill fetching: `POST /api/bill-payments/fetch`, `GET /fetch/:id`, `POST /fetch/:id/refresh`.
Bill payments: `POST/GET /api/bill-payments`, `GET /:id`, `POST /:id/confirm`, `GET/POST /:id/receipt`, `GET /receipts`.
Recharges: `/api/recharges/categories`, `/operators`, `/plans`, `POST /validate`, `POST/GET /`, `GET /:id`, `POST /:id/confirm`.
Recurring: CRUD `/api/bill-payments/recurring`, `GET /reminders`.
Households: CRUD `/api/households`, `POST /:id/invitations`, `GET/POST /:id/bills`.
Control: `/api/control/bill-payments/{overview,providers,transactions,reconciliation,reconciliation/:id/assign,reconciliation/:id/resolve,run}`.
Webhook: `POST /api/bill-payments/webhooks/:providerCode`.

## 5. Provider architecture and actual integrations

`BillPaymentProviderAdapter` declares explicit capabilities (categories, billers, biller details, bill fetch, bill payment, recharge, plans, validation, refunds, complaints, webhooks). The registry gates adapters by `NEXUS_BILLING_SANDBOX_ENABLED`; unconfigured providers return 503 with prerequisites. **Only `sandbox-biller` is configured**, and it is clearly labelled as a test fixture with no BBPS/Bharat Connect/IRDAI/regulatory status. Refunds, complaints and real production providers are not connected.

## 6. Biller categories supported

Category architecture supports electricity, water, piped gas, LPG, broadband, landline, mobile postpaid, mobile prepaid, DTH, FASTag, municipal taxes, society maintenance, education fees and other. Availability is provider-driven; the sandbox exposes a labelled subset (electricity, water, broadband, mobile prepaid, FASTag). Parameters come from provider biller metadata, never hardcoded universal names.

## 7. Bill fetch implementation

Fetch requests validate customer parameters against provider metadata, call `fetchBill`, normalize the response into a `BillSnapshot` with due date, amount range and provider validity, and publish `BILL_FETCH_REQUESTED`. Statuses include FETCH_REQUESTED, FETCH_PROCESSING, FETCHED, NOT_FOUND, INVALID_CUSTOMER_DETAILS, FETCH_FAILED, EXPIRED, PAID, UNKNOWN. `getPayableSnapshot` rejects expired or non-FETCHED bills, and refresh revalidates with the provider before any payment.

## 8. Payment orchestration and reconciliation details

`confirmPayment` advances a durable state machine and calls the existing payment engine with the **original idempotency key**. Scenarios A–F are handled explicitly: (A) wallet SETTLED then provider accepted → BILLER_CONFIRMED with both references and a Nexus Pay receipt; (B) wallet REJECTED → FAILED with no provider call; (C/E) wallet or provider UNKNOWN → UNKNOWN/RECONCILIATION_REQUIRED case, no second debit or provider submission; (D) provider rejects after settlement → settlement preserved, bill not marked paid, reconciliation case, no fabricated refund; (F) duplicate request returns the existing intent. The gateway never mutates balances, creates a second intent or calls Raftline directly. Provider callbacks are signature-verified, deduplicated and processed asynchronously.

## 9. Recharge functionality

Provider-backed plan catalogue with price, validity, allowance and benefits; identifier validation; recharge intents with their own idempotency and state machine; the same two-system settlement/provider flow; and truthful statuses (SUCCESS only from provider confirmation). Sandbox plans are labelled fixtures.

## 10. Recurring bill and reminder implementation

Recurring bills are detected only from two or more provider-confirmed payments, remain unconfirmed until the user confirms them, and carry expected amount ranges and next expected dates. Reminders are deduplicated at 0/1/3/configurable days before due date and sent once with a message that explicitly states no automatic payment occurred. `BillAutoPaymentAuthorization` is an architecture-ready, explicit-opt-in structure; no automatic charging is performed in this release.

## 11. Household management features

Households with OWNER/ADMIN/MEMBER/VIEWER roles, invitations, shared bill visibility and per-member responsibility assignment. Assigning responsibility never moves money, creates group debt or authorises another member to pay; existing Release 3 expense splitting remains the only shared-expense engine.

## 12. Financial insights integration

`loadClassifiedTransactions` now loads provider-confirmed bill payments, skips the engine's duplicate P2P `TransactionRecord` via a `billRefs` set (mirroring merchant payments), and counts each bill payment once as EXPENSE with bill-category detail. Failed, unconfirmed and refunded payments are never reported as completed spending.

## 13. Fraud intelligence integration

Bill events are published through the existing `publishSecurityEvent` outbox: biller account added, bill fetch requested, bill payment initiated/confirmed/failed, recharge initiated/confirmed/failed, repeated payment attempt (via existing rules), biller details changed and auto-payment authorization events. No separate risk engine was created.

## 14. Nexus Control additions

Bill Payments Operations with provider health, biller catalogue, transaction monitoring (wallet and provider references), reconciliation queue with assignment/resolution limited to investigation actions, and an audited worker trigger. Added `bill-payments:read`/`write` permissions; no operator can modify balances, fabricate confirmation, generate new idempotency keys or mark refunds complete without evidence.

## 15. Background workers and webhook handlers

`startBillPaymentWorker()` registered in `instrumentation.ts`: catalogue sync, biller capability sync, signed webhook verification/dedupe/async processing, payment status polling jobs, reminder generation and recurring detection, with leases, backoff and dead-letter handling and correlation IDs.

## 16. Security safeguards

Encrypted account identifiers, masked values in all UI, ownership checks on accounts/bills/receipts/households, RBAC, CSRF, rate limits, signed webhook verification, restricted provider metadata, no secrets in frontend responses, explicit consent-oriented messaging, and append-only audit events. No UPI PINs, bank passwords, OTPs or remote-access requests.

## 17. Tests executed and results

- `pnpm typecheck`, `pnpm lint`, `pnpm build` — pass.
- `pnpm test:unit` — pass (including new bill state-machine, idempotency, masking and permission tests).
- `pnpm test:integration` — pass (including financial-safety tests: failed wallet never reaches biller, unknown wallet reconciles before submission, duplicate request creates one debit, settled transaction never relabelled).
- `pnpm test:e2e` — pass against a production build, including bill discovery, account save, fetch, pay and Control investigation scenarios.

## 18. Environment variables and setup

`NEXUS_BILLING_SANDBOX_ENABLED` (default false), `NEXUS_BILLING_REMINDER_DAYS` (default 7). Added to `.env.example` and documented in `docs/environment-setup.md`. Windows: `pnpm install`, `pnpm --filter @nexus/database db:generate`, `prisma migrate deploy`, `pnpm dev`.

## 19. Known limitations and unfinished work

Sandbox-only provider; no real biller, BBPS/Bharat Connect participation or RBI authorisation. Refunds/reversals and complaints are architecture-ready but unsupported by the sandbox. No automatic bill payment execution, push notification channel or official provider PDF receipts. Provider latency/error metrics are recorded as sync state rather than a full observability stack.

## 20. Confirmation

Releases 1–13 were not rewritten. Changes are additive: new services, models, routes, UI, enum values, permissions, worker registration and a bill-specific skip rule in financial insights. All existing unit, integration and E2E suites still pass. Release 15 was not started.
