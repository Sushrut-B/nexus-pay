# Release 2 — Financial Invariant Report

Scope: Nexus Pay Release 2 on top of Release 1, verified against the live
five-node Raftline cluster and the local PostgreSQL database on 17 November
2026.

## Invariants and enforcement

### I1 — Money is integer minor units only

- All amounts are stored as `BigInt` paise in PostgreSQL and sent as
  `amountCents` to Raftline.
- `parseMajorToMinor` parses strings with `BigInt`, never floating-point math;
  `formatMinorCurrency` formats by string splitting.
- Validation caps payments and funding at 1,000,000 minor units and requires a
  positive integer.
- **Verified by** `packages/shared-types/tests/money.test.ts` (4 tests).

### I2 — Success requires a verified committed receipt

- `verifySettlementReceipt` and `verifyFundingReceipt` compare idempotency key,
  amount, currency, source and destination, require rail `INTERNAL_BOOK`, and
  validate timestamps and balances.
- Funding additionally requires source `SYSTEM_RESERVE`, zero reserve balance
  and a destination balance at least equal to the amount.
- Only a matching `SETTLED` receipt moves the intent/operation to a successful
  terminal state. HTTP acceptance alone never does.
- **Verified by** `tests/unit/verify.test.ts` (8 tests) and the live integration
  test.

### I3 — Ambiguous outcomes stay unresolved

- Timeouts, 5xx and other unknown failures mark the intent `UNKNOWN`; conflicts
  mark it `RECONCILIATION_REQUIRED`. Both are preserved in the database.
- A settled receipt that conflicts with a locally recorded rejection is
  promoted to `RECONCILIATION_REQUIRED`, never silently hidden.
- The UI shows "Verification required" / "Payment is being verified" and keeps
  the original request for reconciliation.
- **Verified by** code review and the state-guard assertions in the unit and
  integration tests.

### I4 — Durable client idempotency; no new key after timeout

- `clientRequestId` is a client-supplied UUID stored with a unique
  `(userId, clientRequestId)` constraint.
- `getOrCreatePaymentIntent` / `getOrCreateFundingOperation` return the existing
  record before doing any work. A row-level `FOR UPDATE` lock plus a second
  existence check closes the creation race.
- The Raftline `idempotencyKey` is generated once at creation and never
  regenerated on retry, refresh or recovery.
- Recovery endpoints look up the original request by `clientRequestId` and only
  reconcile it against Raftline.
- **Verified by** the integration test: repeated request returns the same
  intent, one `PaymentIntent` row and one `TransactionRecord` row.

### I5 — Repeated ledger submission cannot duplicate a debit

- The direct ledger replay in the integration test returns
  `isIdempotentReplay: true` and leaves the recipient balance unchanged.
- `lastWasIdempotentReplay` is persisted as evidence about the ledger outcome;
  it is not a second ledger and is never used to compute balances.
- **Verified by** `tests/integration/release2-payment-invariants.test.ts`.

### I6 — Server-only account resolution and ownership

- Client input never contains a Raftline account ID. Recipient search returns
  only a display name, username and short-lived HMAC-signed token.
- `resolveRecipientToken` re-loads the user and wallet on the server and
  verifies status, username and active INR wallet before settlement.
- Wallet-scoped routes call `getWalletOverviewForUserById` first; another
  customer's wallet returns `404`.
- Self-payment is blocked before an intent is created.
- **Verified by** code review, the E2E journey and ownership-scoped API design.

### I7 — Balances are live and never fabricated

- `buildWalletOverview` reads `getAccount` from Raftline on every request and
  returns `availableMinor`, `reservedMinor`, `ledgerBalanceMinor` and
  `fetchedAt` with `source: "RAFTLINE"`.
- Unreachable ledger or inactive wallet yields `balance: null` plus a reason;
  no cached or database-derived balance is presented.
- **Verified by** the dashboard/wallet UI behavior and the E2E assertion that a
  fresh account shows `₹0.00` only after a successful ledger read.

### I8 — Serialised app-originated account writes

- `withLedgerAccountLocks` acquires PostgreSQL transaction-scoped advisory
  locks in sorted order around funding and settlement calls. It closes the
  read-modify-write race Raftline currently has for account updates.
- **Important caveat:** this is an application-level safeguard, not a consensus
  guarantee. Another application writing to the same Raftline tenant must apply
  equivalent serialisation. The lock is released as soon as the ledger call
  completes.
- **Verified by** the live integration test, which exercises the locked paths.

## Test evidence (17 November 2026)

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed, all 6 workspace projects |
| `pnpm lint` | Passed, 0 warnings |
| `pnpm build` | Passed, 19 static/dynamic routes generated |
| `pnpm test:unit` | 35 tests passed across 4 files |
| `pnpm test:integration` | 3 tests passed across 2 files, live cluster + PostgreSQL |
| `pnpm test:e2e` | 3 tests passed, including fund → send → receipt journey |

## Known limits

- The advisory lock only serialises Nexus Pay writes; it cannot protect against
  external writers to the same Raftline tenant.
- `RECONCILIATION_REQUIRED` is intentionally unresolved until an operator or
  the built-in reconciliation path obtains a verified receipt. The UI never
  guesses an outcome.
- No real bank/UPI/card rails exist. Simulated funding is test money only.
