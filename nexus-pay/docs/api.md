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
