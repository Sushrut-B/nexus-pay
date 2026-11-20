# Nexus Pay API (Release 2)

All routes are served by the Next.js App Router under `/api`. Every response is
JSON except the QR PNG and PDF receipt endpoints.

## Conventions

**Success envelope**

```json
{ "data": { }, "requestId": "..." }
```

**Error envelope**

```json
{ "error": { "category": "PAYMENT_ERROR", "message": "...", "fields": {} }, "requestId": "..." }
```

Common categories: `VALIDATION_ERROR`, `AUTHENTICATION_ERROR`,
`AUTHORIZATION_ERROR`, `DATABASE_ERROR`, `RAFTLINE_UNAVAILABLE`,
`RAFTLINE_TIMEOUT`, `WALLET_PROVISIONING_ERROR`, `PAYMENT_ERROR`,
`RECONCILIATION_REQUIRED`, `RECIPIENT_NOT_FOUND`, `INTERNAL_SERVER_ERROR`.

**Authentication and CSRF**

- Customer routes require the `np_session` cookie. Unauthenticated requests get
  `401 AUTHENTICATION_ERROR`.
- All mutations additionally require `x-csrf-token` to match the `np_csrf`
  cookie and a same-origin `Origin`/`Sec-Fetch-Site` check.
- Requests are rate limited per user or IP; excess requests get `429`.

**Financial rules enforced by the server**

- Ledger account IDs are always resolved server-side from the authenticated
  user and a short-lived signed recipient token.
- `clientRequestId` is a UUID supplied once by the client and stored durably.
  It is the idempotency boundary; a repeated request returns the same intent and
  never creates a second debit.
- A `status` of `SETTLED` / `COMPLETED` is only returned after a committed
  Raftline receipt is verified. Ambiguous outcomes stay unresolved.

---

## Authentication

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | Creates a customer, profile and pending wallet. |
| POST | `/api/auth/login` | Body may include an internal `next` path; returns `redirectTo`. Safe paths only. |
| POST | `/api/auth/logout` | Revokes the current session. |
| POST | `/api/auth/forgot-password` | Sends a reset link in sandbox email mode. |
| POST | `/api/auth/reset-password` | Consumes a reset token. |

## Onboarding and profile

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/onboarding` | Completes onboarding and starts wallet provisioning. |
| PATCH | `/api/profile` | Updates display name/currency/language; returns the updated session view. |

## Wallet

| Method | Route | Response / notes |
| --- | --- | --- |
| GET | `/api/wallet/status` | `WalletOverview` for the user's primary wallet. Balance is a live Raftline read with `fetchedAt`. |
| POST | `/api/wallet/provision` | Idempotent provisioning claim; returns `WalletOverview`. |
| GET | `/api/wallets` | `WalletListResult` with one `WalletOverview` per owned wallet. |
| GET | `/api/wallets/[id]` | Single owned `WalletOverview`; `404` otherwise. |
| GET | `/api/wallets/[id]/balance` | `{ walletId, balance, balanceUnavailableReason, fetchedAt }`. Refreshes from Raftline. |
| POST | `/api/wallets/[id]/fund` | Body `{ clientRequestId, amountMinor }`. Verifies wallet ownership and INR active status, then executes simulated funding. Returns `FundingView`. |

`balanceUnavailableReason` is one of `WALLET_NOT_ACTIVE`, `RAFTLINE_UNAVAILABLE`,
`RAFTLINE_TIMEOUT`, `ACCOUNT_NOT_FOUND`. When it is set, `balance` is `null` —
no balance is guessed.

## Recipients and receiving

| Method | Route | Response / notes |
| --- | --- | --- |
| GET | `/api/recipients/search?q=` | `RecipientSummary` with `displayName`, `username` and a short-lived signed `recipientToken`. Exact username/email/phone only, rate limited, no account IDs. |
| GET | `/api/receive/profile` | `ReceiveProfile` with handle, payment link, wallet status and UPI disclaimer. |
| GET | `/api/receive/qr?download=1` | PNG QR for the authenticated user's payment link. `download=1` adds an attachment header. |

## Payments (P2P)

| Method | Route | Response / notes |
| --- | --- | --- |
| POST | `/api/payments/send` | Body `{ clientRequestId, recipientToken, amountMinor, description? }`. Creates/reuses a durable `PaymentIntent`, settles under an advisory lock and returns `PaymentView`. |
| GET | `/api/payments?page=&pageSize=&filter=&sort=&search=&from=&to=` | `TransactionListResult` with reconciliation of visible unresolved records before listing. |
| GET | `/api/payments/[id]` | `PaymentView` by internal id or payment reference. |
| GET | `/api/payments/[id]/status` | Lightweight status view for polling. |
| GET | `/api/payments/recovery?clientRequestId=` | Recovers the original durable intent after a timeout/refresh without creating a new key. |

## Simulated funding

| Method | Route | Response / notes |
| --- | --- | --- |
| POST | `/api/funding` | Body `{ clientRequestId, amountMinor }`. Returns `FundingView`; labelled simulated. |
| GET | `/api/funding/[id]` | `FundingView` by internal id or funding reference. |
| GET | `/api/funding/recovery?clientRequestId=` | Recovers the original funding operation without issuing a second credit. |

## Transactions and receipts

| Method | Route | Response / notes |
| --- | --- | --- |
| GET | `/api/transactions/[id]` | `TransactionDetail` by internal id **or** ledger payment reference. Includes parties, rail, timeline, replay flag and verification. Ownership enforced. |
| GET | `/api/transactions/[id]/receipt` | PDF receipt. Only issued when the record is `SUCCESSFUL` **and** its ledger receipt is verified; otherwise `409`. |

Next.js cannot host two different dynamic segments at the same path, so the
detail route is `[id]` and accepts either identifier. Customer links use the
payment reference (`/transactions/{paymentRef}`).

## Status semantics

| View status | Meaning |
| --- | --- |
| `SETTLED` / `COMPLETED` | A committed Raftline receipt matched the original instruction. |
| `REJECTED` / `FAILED` | The ledger produced a definitive rejection. No money moved. |
| `PROCESSING` | Created or in flight; outcome not yet known. |
| `UNKNOWN` / `RECONCILIATION_REQUIRED` | Ambiguous or conflicting outcome. Never shown as success; preserved for reconciliation. |

`idempotentReplay: true` means Raftline returned the original receipt for the
same key. It is evidence that no second debit or credit occurred.

---

## Release 3 — Contacts

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/contacts` | `ContactListResult`. Owned contacts only, alphabetical. |
| POST | `/api/contacts` | `{ query, displayLabel? }`. Uses exact-match recipient lookup; self and duplicates rejected. |
| GET | `/api/contacts/[id]` | `ContactView`, ownership enforced. |
| DELETE | `/api/contacts/[id]` | Removes the contact; shared history is retained. |

## Release 3 — Payment requests

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/requests?direction=received\|sent&status=&sort=&page=&pageSize=` | `RequestListResult`. |
| POST | `/api/requests` | `{ payerQuery, amountMinor, currency, description?, dueAt?, groupId?, expenseId? }`. No debit. |
| GET | `/api/requests/summary` | Pending counts and totals for both directions. |
| GET | `/api/requests/[id]` | Request detail; only requester or payer can read. |
| POST | `/api/requests/[id]/accept` | Payer only, `PENDING → ACCEPTED`. Does not move money. |
| POST | `/api/requests/[id]/decline` | Payer only, `PENDING → DECLINED`. |
| POST | `/api/requests/[id]/cancel` | Requester only, `PENDING → CANCELLED`. |
| POST | `/api/requests/[id]/pay` | Payer only. Reuses the durable intent; sets `PAID` only after a verified settlement. |

States: `PENDING → ACCEPTED | DECLINED | CANCELLED | EXPIRED`; `ACCEPTED → PAID`.
Unexpected transitions return `409 PAYMENT_ERROR`. A request past its `dueAt`
becomes `EXPIRED`.

## Release 3 — Groups and expenses

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/groups` | `GroupListResult` with the caller's net balance. |
| POST | `/api/groups` | `{ name, category, description?, imageUrl?, memberQueries[] }`. Creator is ADMIN. |
| GET | `/api/groups/[groupId]` | `GroupDetail` with members and roles. |
| PATCH | `/api/groups/[groupId]` | ADMIN only; name, description, category, image, archive. |
| POST | `/api/groups/[groupId]/members` | ADMIN only; `{ query }`. |
| DELETE | `/api/groups/[groupId]/members/[userId]` | ADMIN only; soft-removes membership. |
| GET | `/api/groups/[groupId]/expenses` | `ExpenseListResult` for members. |
| POST | `/api/groups/[groupId]/expenses` | `{ title, totalAmountMinor, category, expenseDate, paidByUserId, splitMethod, participants[] }`. |
| GET | `/api/groups/[groupId]/expenses/[expenseId]` | Expense splits and payer. |
| PATCH | `/api/groups/[groupId]/expenses/[expenseId]` | Members may edit; records an audit/activity trail and recalculates balances. |
| DELETE | `/api/groups/[groupId]/expenses/[expenseId]` | Soft delete; blocked when the group has confirmed settlements. |
| GET | `/api/groups/[groupId]/balances` | `GroupBalances`; `consistent: false` never returned with misleading values. |
| GET | `/api/groups/[groupId]/suggested-settlements` | Greedy debt-simplified payment plan. |
| GET | `/api/groups/[groupId]/settlements` | Settlements visible to the member. |
| POST | `/api/groups/[groupId]/settlements` | `{ payeeUserId, amountMinor, clientRequestId }`. Creates and executes via the Release 2 engine. |
| GET | `/api/groups/[groupId]/settlements/[settlementId]` | Settlement detail by member. |
| GET | `/api/groups/[groupId]/activity` | `ActivityListResult` of real events. |

Split methods: `EQUAL`, `CUSTOM` (exact minor amounts), `PERCENTAGE` (must sum
to 100), `SHARES` (ratios). All allocations are integer paise and sum exactly
to the expense total.

## Release 3 — Notifications

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/notifications?page=&pageSize=` | `NotificationListResult` with unread count. |
| GET | `/api/notifications/unread-count` | `{ unreadCount }`. |
| PATCH | `/api/notifications/[id]/read` | Marks a caller-owned notification as read. |

Notifications are persisted in PostgreSQL and generated for requests, group
membership, expenses and settlements. The header notification center polls
every 30 seconds; no WebSockets or external push are used.

---

## Release 4 — Personal finance

All endpoints require authentication, validate input and enforce ownership.
All monetary figures are integer minor units.

### Insights

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/insights/overview?period=&from=&to=` | `FinanceOverview`. Periods: month, last_month, last_3_months, last_6_months, year, custom. |
| GET | `/api/insights/cash-flow?period=` | Cash flow, weekly and daily buckets. |
| GET | `/api/insights/spending?period=` | Eligible spending and period comparison. |
| GET | `/api/insights/categories?period=` | Category breakdown. |
| GET | `/api/insights/comparison?period=` | Current vs previous period totals. |
| GET | `/api/insights/transactions?period=&categoryId=&search=&minMinor=&maxMinor=` | Underlying transactions for a category drill-down. |

Inclusion policy: only `SUCCESSFUL` P2P transactions with a ledger reference.
Funding, failed/unconfirmed payments, personal transfers and group obligations
are excluded from spending. Each payment is counted once because the read model
is unique per `(user, paymentRef)`.

### Categorization

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/transactions/categories` | System plus user categories and the caller's categorizations. |
| PATCH | `/api/transactions/[id]/category` | `{ paymentRef, categoryId, note? }`. Never modifies the transaction. |
| GET | `/api/transactions/category-rules` | User-specific rules, highest priority first. |
| POST | `/api/transactions/category-rules` | `{ conditionType, conditionValue, categoryId, priority, isEnabled }`. |
| PATCH | `/api/transactions/category-rules/[id]` | Edit a rule. |
| DELETE | `/api/transactions/category-rules/[id]` | Remove a rule. |

Resolution order: manual choice → highest-priority enabled rule (ties by
creation order) → Uncategorized. The `[id]` segment is shared with the existing
transaction detail route for Next.js compatibility.

### Budgets

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/budgets` | Budgets with utilization and crossed thresholds. |
| POST | `/api/budgets` | `{ name, categoryId, amountMinor, currency, periodType, startDate, endDate?, thresholds[] }`. |
| GET | `/api/budgets/[id]` | Budget detail; syncs threshold alerts once. |
| PATCH | `/api/budgets/[id]` | Edit or pause/complete/cancel. |
| DELETE | `/api/budgets/[id]` | Delete a budget and its alert history. |

Thresholds are recorded once per `(budget, periodStart, threshold)`; reopening
the dashboard never re-notifies.

### Savings goals

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/savings/goals` | Goals with recorded/planned totals. |
| POST | `/api/savings/goals` | `{ name, targetAmountMinor, currency, targetDate?, description?, icon? }`. |
| GET | `/api/savings/goals/[id]` | Goal detail with contributions. |
| PATCH | `/api/savings/goals/[id]` | Edit details or status. |
| POST | `/api/savings/goals/[id]/contributions` | `{ amountMinor, contributionType, note?, relatedPaymentRef? }`. |

Contributions are planning events. `RECORDED` counts toward progress, `PLANNED`
does not. No money moves.

### Scheduled payments

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/scheduled-payments` | Caller's schedules. |
| POST | `/api/scheduled-payments` | `{ recipientQuery, amountMinor, currency, description?, frequency, startDate, endDate?, maxExecutions? }`. |
| GET | `/api/scheduled-payments/[id]` | Schedule detail. |
| PATCH | `/api/scheduled-payments/[id]` | Edit eligible fields. |
| POST | `/api/scheduled-payments/[id]/pause` | Pause an active schedule. |
| POST | `/api/scheduled-payments/[id]/resume` | Resume a paused schedule. |
| POST | `/api/scheduled-payments/[id]/cancel` | Cancel a schedule. |
| GET | `/api/scheduled-payments/[id]/executions` | Execution history. |
| POST | `/api/scheduled-payments/run` | Manual scheduler trigger (rate limited). |

The server-side worker (`instrumentation.ts` → `schedule-worker.ts`, or
`scripts/run-scheduler.ts`) claims due executions atomically. The execution key
`scheduleId:scheduledForISO` is the idempotency boundary and becomes the payment
intent's client request id. Ambiguous outcomes retry the same intent (max 3
attempts); definitive rejections require attention.

### Recurring and calendar

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/recurring/suggestions` | Detected patterns; suggestions only. |
| POST | `/api/recurring/suggestions/[id]/confirm` | Explicitly creates a schedule. |
| POST | `/api/recurring/suggestions/[id]/ignore` | Ignore a suggestion. |
| GET | `/api/calendar/events?from=&to=` | Scheduled payments, budget boundaries, goal dates and estimates. |

### Statements

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/statements/generate` | `{ format: PDF\|CSV, periodStart, periodEnd }`. |
| GET | `/api/statements` | Generated statements. |
| GET | `/api/statements/[id]` | Metadata and totals. |
| GET | `/api/statements/[id]/download` | Streams the file; ownership checked; `no-store`. |

PDF statements use `INR` (standard PDF fonts cannot encode ₹); CSV keeps Unicode.

---

## Release 5 — Nexus Control (`/api/control/**`)

All endpoints require the isolated `np_control_session` cookie, enforce RBAC
server-side, validate input, rate-limit sensitive actions and audit privileged
operations. Every Raftline request is server-side.

| Method | Route | Permission |
| --- | --- | --- |
| POST | `/api/control/auth/login` | public (rate limited) |
| POST | `/api/control/auth/logout` | authenticated admin |
| GET | `/api/control/session` | authenticated admin |
| GET | `/api/control/overview` | `cluster:read` |
| GET | `/api/control/cluster/status` | `cluster:read` |
| GET | `/api/control/nodes` | `nodes:read` |
| GET | `/api/control/nodes/[nodeId]` | `nodes:read` |
| GET | `/api/control/leader-history` | `leader:read` |
| GET | `/api/control/metrics?range=hour\|day\|week\|month` | `metrics:read` |
| GET | `/api/control/payments?paymentRef=&intentId=&idempotencyKey=&status=` | `payments:read` |
| GET | `/api/control/payments/[id]` | `payments:read` |
| GET | `/api/control/reconciliation` | `reconciliation:read` |
| POST | `/api/control/reconciliation/open` | `reconciliation:write` |
| POST | `/api/control/reconciliation/[id]/investigate` | `reconciliation:write` |
| POST | `/api/control/reconciliation/[id]/resolve` | `reconciliation:write` |
| GET | `/api/control/chaos/operations` | `chaos:read` |
| POST | `/api/control/chaos/inject` | `chaos:write` |
| POST | `/api/control/chaos/heal` | `chaos:heal` |
| GET | `/api/control/chaos/[id]` | `chaos:read` |
| GET | `/api/control/alerts` | `alerts:read` |
| POST | `/api/control/alerts/[id]/acknowledge` | `alerts:write` |
| GET | `/api/control/audit` | `audit:read` |
| GET | `/api/control/diagnostics` | `diagnostics:read` |
| GET/POST/PATCH | `/api/control/admin` | `admin:write` (SUPER_ADMIN) |

Chaos injection body: `{ nodeId, scenario, reason, peer?, delayMs?, dropRate? }`.
Heal body: `{ nodeId, reason, all, peer? }`. Only scenarios from Raftline's
`ChaosScenario` enum are accepted; unsupported modes are rejected before any
backend call. Details: `docs/nexus-control.md`.

---

## Release 6 — Merchant ecosystem

All routes require the `np_session` cookie and merchant ownership checks unless
noted. Mutations require the CSRF token. Amounts are integer paise (`INR`).

### Onboarding

| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/merchants` | Creates a DRAFT merchant linked to the current user. |
| GET | `/api/merchants` | Current user's merchant. |
| GET | `/api/merchants/me` | Current merchant status (`NONE` when absent). |
| PATCH | `/api/merchants/me` | Update business profile. |
| POST | `/api/merchants/provision` | Idempotent Raftline business-account provisioning. |
| POST | `/api/merchants/submit` | Submit for sandbox review. |

### Orders, links and checkout

| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/merchant/orders` | List / create orders. |
| GET/POST | `/api/merchant/orders/[orderId]` | Details / cancel. |
| GET/POST | `/api/merchant/payment-links` | List / create payment links (unguessable tokens). |
| GET/POST | `/api/merchant/payment-links/[id]` | Details / disable. |
| GET | `/api/checkout/[token]` | Public checkout data; amount derived server-side, rate limited. |
| POST | `/api/checkout/[token]/confirm` | Idempotent settlement via existing payment engine. |
| GET | `/api/checkout/[token]/status` | Checkout session / payment status. |
| GET | `/api/merchant-qr/[handle]` | Public merchant QR resolution. |
| POST | `/api/merchant-qr/[handle]/pay` | Static QR payment (customer enters amount). |
| GET | `/api/merchant/qr/link/[token]` | Dynamic QR PNG for a payment link (amount fixed server-side). |

### Payments, refunds and reporting

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/merchant/payments` / `/api/merchant/payments/[id]` | Verified settlement records. |
| GET/POST | `/api/merchant/refunds` | Refund requests (request/review only). |
| GET | `/api/merchant/analytics/overview?range=` | Scope-limited analytics; `today\|week\|month\|90days\|custom`. |
| GET | `/api/merchant/customers` | Purchaser history with masked contact data. |

### Integrations

| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/merchant/webhooks` | Manage webhook endpoints. |
| PATCH/DELETE | `/api/merchant/webhooks/[id]` | Update / delete endpoint. |
| POST | `/api/merchant/webhooks/[id]/test` | Queue a labelled test event. |
| POST | `/api/merchant/webhooks/[id]/rotate` | Rotate signing secret. |
| GET | `/api/merchant/webhooks/[id]/deliveries` | Delivery history for one endpoint. |
| GET | `/api/merchant/webhooks/deliveries` | All delivery attempts for the merchant. |
| POST | `/api/merchant/webhooks/deliveries/[id]/retry` | Manually re-queue a failed delivery. |
| POST | `/api/merchant/webhooks/run` | Drain the outbox (worker alternative). |
| GET/POST | `/api/merchant/api-keys` | Scoped, hashed developer keys. |
| DELETE/POST | `/api/merchant/api-keys/[id]` | Revoke / rotate key. |
| GET/POST | `/api/v1/merchant/orders` | Developer API (Bearer key + scope). |

### Nexus Control merchant operations

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/control/merchants` | `cluster:read` |
| POST | `/api/control/merchants/[id]/status` | `admin:write` (approve/suspend/reactivate) |
| GET | `/api/control/merchant-refunds` | `payments:read` |
| POST | `/api/control/merchant-refunds/[id]/review` | `reconciliation:write` |

**Refund limitation.** Raftline has no refund/reversal endpoint. Requests stop at
request/review; no money is moved and no refund is marked settled by execution.
See `docs/merchant-refunds.md`, `docs/merchant-webhooks.md` and
`docs/merchant-developer-api.md`.

---

## Release 7 — Subscriptions & recurring billing

All merchant routes require `np_session`, merchant ownership and CSRF on mutations.
Amounts are integer paise. Raftline has no mandate/recurring capability, so each
renewal is a separate, explicitly authorised sandbox wallet settlement.

### Merchant plans & subscriptions

| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/merchant/plans` | List / create plans. |
| GET/PATCH | `/api/merchant/plans/[id]` | Details / update (never rewrites existing snapshots). |
| POST | `/api/merchant/plans/[id]/status` | DRAFT / ACTIVE / ARCHIVED. |
| GET | `/api/merchant/subscriptions` / `[id]` | Subscribers (scoped). |
| POST | `/api/merchant/subscriptions/[id]/pause` / `/resume` / `/cancel` / `/plan-change` | Lifecycle actions. |
| GET | `/api/merchant/subscriptions/[id]/events` / `/occurrences` | Append-only history / billing periods. |

### Invoices & revenue

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/merchant/invoices` / `[id]` | Merchant-scoped invoices. |
| GET | `/api/merchant/invoices/[id]/pdf` | Sandbox invoice PDF. |
| POST | `/api/merchant/invoices/[id]/void` | Void an unpaid invoice. |
| GET | `/api/merchant/billing/analytics?range=` | MRR/ARR/churn with definitions. |
| GET | `/api/merchant/billing/recovery` | Failed renewals, at-risk subscriptions. |
| POST | `/api/merchant/billing/run` | Trigger one worker pass (rate limited). |

### Public checkout & customer portal

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/subscribe/[token]` | Public plan data; prices from DB only. |
| POST | `/api/subscribe/[token]/confirm` | `{ clientRequestId, acceptTerms: true }`; idempotent. |
| GET | `/api/subscriptions` / `[id]` | Customer's own subscriptions. |
| GET | `/api/subscriptions/[id]/events` / `/occurrences` / `/invoices` | Customer-scoped history. |
| POST | `/api/subscriptions/[id]/cancel` | End-of-period cancellation. |
| GET | `/api/invoices` / `/api/invoices/[id]/pdf` | Customer's own invoices. |

### Subscription webhooks & Nexus Control

Webhook event types additionally include `subscription.created`,
`subscription.trial_started`, `subscription.activated`, `subscription.trial_ended`,
`subscription.past_due`, `subscription.paused`, `subscription.resumed`,
`subscription.plan_changed`, `subscription.cancellation_scheduled`,
`subscription.cancelled`, `invoice.created`, `invoice.paid`, `invoice.past_due`.
Signing and delivery follow `docs/merchant-webhooks.md`.

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/control/subscriptions?q=&status=` | `payments:read` |
| GET | `/api/control/billing-metrics` | `payments:read` |
| GET | `/api/control/subscription-invoices?status=` | `payments:read` |

Details: `docs/subscription-guide.md`, `docs/subscription-billing.md`.

---

## Release 8 — Rewards, cashback, loyalty & offers

Points are non-cash loyalty units; cashback is a separate sandbox wallet credit.
All amounts are integer paise. Customer routes require `np_session`, merchant routes
additionally require merchant ownership, and Control routes use `rewards:read/write`.

### Customer

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/rewards/summary` | Points, cashback, offers, membership snapshot. |
| GET | `/api/rewards/ledger` | Paginated append-only ledger. |
| GET | `/api/rewards/activity` | Paginated activity with event/status filters. |
| GET/POST | `/api/rewards/catalogue` | List items / atomic redemption. |
| GET | `/api/rewards/redemptions` | User's redemptions and voucher hints. |
| GET | `/api/rewards/offers` / `/offers/[id]` | Eligible offers only. |
| POST | `/api/rewards/promo/validate` | Server-calculated discount + reservation. |
| GET | `/api/rewards/membership` | Tier, progress and history. |
| GET | `/api/rewards/referrals` / `/summary` | Code, link and rewards. |
| GET | `/api/rewards/cashback` | Entitlement history. |

### Merchant

| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/merchant/rewards/campaigns` | List / create drafts. |
| GET/PATCH | `/api/merchant/rewards/campaigns/[id]` | Details / edit draft. |
| POST | `/api/merchant/rewards/campaigns/[id]/submit` | Submit for approval. |
| POST | `/api/merchant/rewards/campaigns/[id]/pause` | Pause active campaign. |
| GET | `/api/merchant/rewards/analytics` | Merchant-scoped performance. |
| GET | `/api/merchant/rewards/redemptions` | Merchant-scoped redemptions. |

### Nexus Control

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/control/rewards/overview` | `rewards:read` |
| GET | `/api/control/rewards/campaigns` | `rewards:read` |
| POST | `/api/control/rewards/campaigns/[id]/approve` | `rewards:write`, SUPER_ADMIN |
| POST | `/api/control/rewards/campaigns/[id]/reject` | `rewards:write` |
| POST | `/api/control/rewards/campaigns/[id]/pause` | `rewards:write` |
| GET/POST | `/api/control/rewards/investigations` | `rewards:read/write` |
| POST | `/api/control/rewards/adjustments` | `rewards:write` |
| GET | `/api/control/rewards/reconciliation` | `rewards:read` |
| GET | `/api/control/rewards/cashback` | `rewards:read` |
| GET | `/api/control/rewards/risk-events` | `rewards:read` |
| POST | `/api/control/rewards/run` | `rewards:write` |

Details: `docs/rewards-architecture.md`, `docs/points-ledger.md`,
`docs/cashback-processing.md`, `docs/campaign-guide.md`.

---

## Release 9 — Financial intelligence

All values are derived read models in integer paise; no source transaction is
mutated. Customer routes require `np_session`; Control routes use `finance:read/write`.

### Customer

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/finance/overview` | Period overview with previous-period comparison. |
| GET | `/api/finance/cashflow` | Daily inflow/outflow/net series. |
| GET | `/api/finance/categories` / `/merchants` / `/trends` | Spending breakdowns. |
| GET | `/api/finance/data-quality` | Completeness and unresolved records. |
| GET | `/api/finance/recurring` | Detect + list patterns (never schedules payments). |
| POST | `/api/finance/recurring/[id]/confirm` / `/ignore` | User decisions. |
| PATCH | `/api/finance/recurring/[id]` | Edit a confirmed pattern. |
| GET | `/api/finance/subscriptions/overview` / `/upcoming` | Commitment intelligence. |
| GET/POST | `/api/finance/goals` | Planned vs recorded savings goals. |
| POST | `/api/finance/goals/[id]/contributions` | Planned or recorded contribution. |
| GET | `/api/finance/forecasts` / POST `/refresh` | Forecast with assumptions. |
| GET | `/api/finance/anomalies` / POST `/[id]/feedback` | Informational deviations. |
| GET | `/api/finance/health-score` / `/history` | Explainable wellbeing score. |
| GET | `/api/finance/insights` / POST `/[id]/feedback` | Generated insights. |
| GET | `/api/finance/budget-recommendations` / POST `/[id]/decide` | Approval required. |
| POST | `/api/finance/assistant/chat` | Deterministic structured-query assistant. |
| GET | `/api/finance/assistant/conversations` / `/[id]` | Conversation history. |
| GET/POST | `/api/finance/reports` | Create/list reports. |
| GET | `/api/finance/reports/[id]/download` | Ownership-protected PDF/CSV. |
| GET/PATCH | `/api/finance/preferences` | User preferences. |

### Nexus Control

| Method | Route | Permission |
| --- | --- | --- |
| GET | `/api/control/finance/operations` | `finance:read` |
| GET | `/api/control/finance/jobs` | `finance:read` |
| GET | `/api/control/finance/data-quality` | `finance:read` |
| POST | `/api/control/finance/run` | `finance:write` |

Details: `docs/financial-data-architecture.md`, `docs/transaction-classification-rules.md`,
`docs/cash-flow-calculations.md`, `docs/forecasting-and-detection.md`,
`docs/assistant-and-reports.md`.

---

## Release 10 — Unified financial hub

External data is provider-reported and read-only. Only the `sandbox` provider is
configurable in this release; all other providers return a documented unavailable state.

### Customer
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/accounts` / `/api/accounts/[id]` | Nexus wallet plus connected accounts. |
| POST | `/api/accounts/connect` | Consent review + initiate connection. |
| GET | `/api/accounts/callback` | Verified provider callback (state + replay protection). |
| GET | `/api/accounts/connections` / `/consents` / `/consents/[id]` | Connection and consent state. |
| POST | `/api/accounts/consents/[id]/renew` / `/revoke` | Consent lifecycle. |
| POST | `/api/accounts/[id]/sync` | Enqueue durable sync job. |
| GET | `/api/accounts/[id]/sync-status` / `/sync-history` | Sync monitoring. |
| GET | `/api/accounts/transactions` / `/transactions/[id]` | Unified transaction history. |
| GET | `/api/accounts/analytics/overview` / `/balances` / `/cashflow` / `/transfers` | Scoped analytics. |
| POST | `/api/accounts/transfers/[id]/decide` | Confirm/reject transfer suggestion. |
| GET | `/api/accounts/providers` / `/dedupe` | Provider availability and duplicates. |
| GET | `/api/privacy/data-access` / `/consent-history` | Privacy centre. |
| POST | `/api/privacy/data-deletion-request` | Record deletion request. |

### Nexus Control (`accounts:read/write`)
| GET | `/api/control/accounts/overview` `/health` `/jobs` `/callbacks` `/audits` | Operational health. |
| POST | `/api/control/accounts/run` | Run worker / retry failed jobs (audited). |

Details: `docs/external-financial-architecture.md`, `docs/provider-setup.md`.

---

## Release 11 — Credit marketplace

Nexus Pay is not a lender. Only the env-gated `sandbox-lender` is available;
all other providers return a documented unavailable state.

### Customer
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/credit/providers` | Configured lender providers. |
| GET | `/api/credit/products` / `/products/[id]` | Provider-backed products / labelled fixtures. |
| GET | `/api/credit/offers` / `/offers/[id]` | Active offers. |
| POST | `/api/credit/offers/compare` | 2–4 offers, documented EMI assumptions. |
| POST | `/api/credit/eligibility` / GET `/eligibility/[id]` | Pre-assessment only, never approval. |
| GET/POST | `/api/credit/applications` | Create/list applications. |
| GET/PATCH | `/api/credit/applications/[id]` | Details / edit before submission. |
| POST | `/api/credit/applications/[id]/submit` | Idempotent provider submission. |
| POST | `/api/credit/applications/[id]/withdraw` | Customer withdrawal. |
| GET/POST | `/api/credit/applications/[id]/documents` | Encrypted document management. |
| GET/DELETE | `/api/credit/documents/[id]` | Signed download link / delete. |
| GET | `/api/credit/documents/[id]/download` | Short-lived authorised download. |
| GET | `/api/credit/loans` / `/loans/[id]` | Verified active loans. |
| GET | `/api/credit/loans/[id]/schedule` / `/repayments` / `/documents` | Servicing data. |
| GET/POST | `/api/credit/affordability/scenarios` | Release 9-backed scenarios. |
| GET | `/api/credit/borrowing` | Borrowing overview. |
| POST | `/api/credit/webhooks/[providerCode]` | Signature-verified provider events. |

### Nexus Control (`credit:read/write`)
| GET | `/api/control/credit/overview` `/applications` `/events` `/consents` | Operations monitoring. |
| POST | `/api/control/credit/run` | Audited provider sync. |

Details: `docs/credit-marketplace-architecture.md`, `docs/loan-calculations-and-servicing.md`.

## Release 12 — Insurance Marketplace

All endpoints use the common `{ data, requestId }` envelope. Mutations require CSRF and authenticated merchant users. Provider-backed operations are unavailable (503) unless `NEXUS_INSURANCE_SANDBOX_ENABLED=true`; sandbox values are labelled fixtures, not real coverage.

### Marketplace / catalogue
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/insurance/categories` `/providers` | Categories and provider availability. |
| GET | `/api/insurance/products` `/products/[id]` | Provider-backed products / labelled fixtures. |
| GET | `/api/insurance/products/[id]/documents` | Official product documents. |
| POST | `/api/insurance/products/compare` | 2–4 products; same category only; no ranking score. |

### Quotes & applications
| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/insurance/quotes` | List / create provider quote with recorded consent. |
| GET | `/api/insurance/quotes/[id]` | Quote detail (validity, premium breakdown). |
| POST | `/api/insurance/quotes/[id]/refresh` | Refresh from provider. |
| GET/POST | `/api/insurance/applications` | List / create application with disclosures. |
| GET | `/api/insurance/applications/[id]` | Application detail. |
| POST | `/api/insurance/applications/[id]/submit` `/cancel` | Idempotent submission / cancellation. |
| GET/POST | `/api/insurance/applications/[id]/documents` | Encrypted document management. |

### Policies, premiums & renewals
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/insurance/policies` `/policies/[id]` | Provider-confirmed policies only. |
| GET | `/api/insurance/policies/[id]/premiums` `/renewals` | Premium schedule / renewals. |
| POST | `/api/insurance/policies/[id]/renewal/quote` | Provider renewal info; requires confirmation. |
| GET/POST | `/api/insurance/policies/[id]/documents` | Encrypted document management. |

### Claims, consents & documents
| Method | Route | Notes |
| --- | --- | --- |
| GET/POST | `/api/insurance/claims` | List / initiate claims. |
| GET | `/api/insurance/claims/[id]` `/history` | Claim detail / verified status history. |
| POST | `/api/insurance/claims/[id]/submit` | Claim submission where supported. |
| GET/POST | `/api/insurance/consents` | Consent history / grant. |
| POST | `/api/insurance/consents/[id]/revoke` | Stops future provider sharing. |
| GET | `/api/insurance/activity` `/preferences` | Activity feed / notification preferences. |
| GET/DELETE | `/api/insurance/documents/[id]` | Signed download link / delete. |
| GET | `/api/insurance/documents/[id]/download` | Short-lived authorised download. |
| POST | `/api/insurance/webhooks/[providerCode]` | Signature-verified, deduplicated provider events. |

### Nexus Control (`insurance:read/write`)
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/control/insurance/overview` `/applications` `/events` `/consents` | Operations monitoring (no PII). |
| POST | `/api/control/insurance/run` | Audited provider sync. |

Details: `docs/insurance-marketplace-architecture.md`, `docs/insurance-provider-onboarding.md`, `docs/release-12-report.md`.

## Release 13 — Fraud Intelligence

### Customer security
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/security/overview` | Security metrics; no fabricated fraud statistics. |
| GET | `/api/security/activity` | Masked security event timeline. |
| GET | `/api/security/sessions` / DELETE `/sessions/:sessionId` | Session visibility and revocation. |
| POST | `/api/security/sessions/revoke-others` | Revoke all other sessions. |
| GET | `/api/security/devices` / PATCH, DELETE `/devices/:deviceId` | Device management. |
| POST | `/api/security/verify-sensitive-action` | Password-based step-up (MFA extension point). |
| GET/POST | `/api/security/reports` | Customer fraud reports. |
| GET | `/api/security/reports/:reportId` `/history` | Report status and audit history. |
| POST | `/api/security/reports/:reportId/documents` | Encrypted supporting documents. |
| GET | `/api/security/report-documents/:id/download` | Signed short-lived download. |
| GET | `/api/security/safety-guides` `/warnings` | Scam education and contextual warnings. |
| POST | `/api/security/warnings/:warningId/acknowledge` | Acknowledge a warning. |

### Nexus Control (`fraud:read` / `fraud:write`)
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/control/fraud/overview` `/events` `/alerts` `/alerts/:id` | Measured monitoring. |
| GET | `/api/control/fraud/cases` `/cases/:id` | Investigation queue and detail. |
| POST | `/api/control/fraud/cases` `/cases/:id/assign` `/notes` `/escalate` `/resolve` | Audited investigation workflow. |
| POST | `/api/control/fraud/alerts/:alertId/acknowledge` `/case` | Alert handling. |
| GET/POST | `/api/control/fraud/rules` | Rule configuration. |
| PATCH | `/api/control/fraud/rules/:ruleId` | Versioned, audited rule change. |
| GET/PATCH | `/api/control/fraud/risk-policies` `/:policyId` | Threshold and action policy. |
| GET | `/api/control/fraud/models` `/audit` `/run` | Model governance, audit, event worker. |

Details: `docs/fraud-intelligence-architecture.md`, `docs/risk-engine-and-rules.md`, `docs/payment-risk-gateway.md`, `docs/release-13-report.md`.

## Release 14 — Bill payments & recharges

### Biller discovery and accounts
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/bill-payments/categories` `/billers` `/billers/:id` `/billers/:id/parameters` | Provider-backed catalogue or unavailable state. |
| GET/POST | `/api/bill-payments/accounts` | Saved bill accounts (masked identifiers). |
| GET/PATCH/DELETE | `/api/bill-payments/accounts/:id` | Account management. |

### Bill fetch and payments
| Method | Route | Notes |
| --- | --- | --- |
| POST | `/api/bill-payments/fetch` | Provider bill fetch with validated parameters. |
| GET/POST | `/api/bill-payments/fetch/:id` `/fetch/:id/refresh` | Fetch state and revalidation. |
| GET/POST | `/api/bill-payments` | List / create bill payment intents. |
| GET | `/api/bill-payments/:id` | Payment state with distinct stage labels. |
| POST | `/api/bill-payments/:id/confirm` | Existing payment engine + provider submission. |
| GET/POST | `/api/bill-payments/:id/receipt` | Nexus Pay payment record. |
| GET | `/api/bill-payments/receipts` | Receipt list. |

### Recharges, recurring, households
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/recharges/categories` `/operators` `/plans` | Provider-backed plan catalogue. |
| POST | `/api/recharges/validate` `/recharges` `/recharges/:id/confirm` | Validation and recharge flow. |
| GET | `/api/recharges` `/recharges/:id` | Recharge history. |
| GET/POST | `/api/bill-payments/recurring` | Recurring bills. |
| PATCH/DELETE | `/api/bill-payments/recurring/:id` | Recurring bill management. |
| GET | `/api/bill-payments/reminders` | Reminder schedule. |
| GET/POST | `/api/households` `/households/:id` `/households/:id/invitations` `/households/:id/bills` | Household responsibilities (no money movement). |

### Nexus Control (`bill-payments:read` / `write`)
| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/control/bill-payments/overview` `/providers` `/transactions` `/reconciliation` `/reconciliation/:caseId` | Operations monitoring. |
| POST | `/api/control/bill-payments/reconciliation/:caseId/assign` `/resolve` `/run` | Audited investigation workflow. |

Details: `docs/bill-payment-architecture.md`, `docs/biller-provider-guide.md`, `docs/release-14-report.md`.

## Release 15 — Travel & mobility

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/travel/categories` `/providers` | Provider availability and honest unavailable states. |
| POST | `/api/travel/search` | Provider-backed search with snapshots. |
| GET | `/api/travel/search/:id` `/results` | Search state and labelled results. |
| GET | `/api/travel/products/:id` | Provider product metadata. |
| POST | `/api/travel/products/:id/revalidate` | Fresh fare with validity window. |
| GET/POST | `/api/travel/bookings` | Booking list / drafts. |
| GET | `/api/travel/bookings/:id` | Booking state with distinct stage labels. |
| POST | `/api/travel/bookings/:id/confirm` | Existing engine, then provider. |
| GET | `/api/travel/bookings/:id/ticket` `/confirmation` `/cancellation` `/refund` | Tickets, history and refund state. |
| POST | `/api/travel/bookings/:id/cancel` | Provider-supported cancellation. |
| GET/POST | `/api/travel/trips` `/trips/:id` `/trips/:id/itinerary` `/budget` `/expenses` `/documents` | Trip and itinerary management. |
| GET/POST | `/api/travel/documents` `/documents/:id/download` | Signed private document access. |
| POST | `/api/travel/webhooks/:providerCode` | Signature-verified, deduplicated callbacks. |
| GET | `/api/control/travel/overview` `/providers` `/bookings` `/reconciliation(/:id)` | Travel operations. |
| POST | `/api/control/travel/reconciliation/:id/assign` `/resolve` `/run` | Audited investigation workflow. |

Details: `docs/travel-architecture.md`, `docs/travel-provider-guide.md`, `docs/release-15-report.md`.

## Release 16 — Investments & wealth

| Method | Route | Notes |
| --- | --- | --- |
| GET | `/api/investments/portfolio` `/performance` `/allocation` `/holdings` `/transactions` | Provider snapshots with source timestamps. |
| GET/POST | `/api/investments/providers` `/connections` | Provider list and consent-based connections. |
| GET/POST | `/api/investments/connections/:id/authorize` `/sync` `/sync-status` `/revoke-consent` DELETE `/connections/:id` | Connection lifecycle. |
| GET | `/api/investments/funds` `/funds/:id` `/instruments` `/instruments/:id` | Informational discovery; no trading. |
| GET/POST | `/api/investments/watchlists` `/alerts` | Watchlists and price alerts. |
| POST | `/api/investments/sip/calculator` | Hypothetical projection; not an SIP mandate. |
| GET | `/api/investments/sips` `/plans` `/goals` `/fixed-income` `/insights` `/documents` | Tracking and records. |
| POST | `/api/investments/goals` `/goals/:id/contributions` `/fixed-income` `/insights/refresh` `/documents` | Planning and document upload. |
| GET | `/api/investments/documents/:id/download` | Signed short-lived document access. |
| GET | `/api/wealth/net-worth` `/history` `/assets` `/liabilities` | Net worth reuses existing account analytics. |
| POST | `/api/wealth/net-worth/snapshot` | Persist a net-worth snapshot. |
| GET | `/api/control/investments/overview` `/providers` `/jobs` `/history` `/documents` | Investment operations. |
| POST | `/api/control/investments/jobs/:id/retry` `/providers/:code/pause` `/run` | Audited read-only operations. |

Details: `docs/investment-architecture.md`, `docs/investment-provider-guide.md`, `docs/release-16-report.md`.
