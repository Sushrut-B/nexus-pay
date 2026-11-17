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
