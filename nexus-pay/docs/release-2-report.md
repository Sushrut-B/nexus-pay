# Nexus Pay — Release 2 Report

Date: 17 November 2026
Scope: Release 2 only. Release 1 is unchanged except for additive integration
points; Release 3 is not started.

## Delivered and verified

| Deliverable | Status | Evidence |
| --- | --- | --- |
| `/home` dashboard with live freshness, reserved balance and refresh | Verified | `pnpm build`, E2E customer journey, manual UI state |
| `/wallet` with live balances, funding history and activity | Verified | Build + E2E release-2 journey |
| `/wallet/add-money` simulated funding wizard | Verified | E2E: funds a sandbox wallet, receipt and balance after credit |
| `/send` recipient search, review and verified result | Verified | E2E: sends to a second live customer, result "Payment successful" |
| `/receive` handle, share and QR | Verified | E2E asserts handle and QR alt text |
| `/transactions` filters, search, dates, sorting, pagination | Verified | Build + E2E navigation and row rendering |
| `/transactions/[paymentRef]` detail, timeline, parties, PDF receipt | Verified | E2E asserts reference and receipt link; PDF route is verified-only |
| `/pay/[username]` payment link landing page | Verified | Build; link resolves a verified recipient and forwards via `/send?to=` |
| Legacy redirects `/add-money`, `/history`, `/history/[id]` | Verified | Build route table |
| Payment/funding DB models, migrations and replay evidence | Verified | 4 Prisma migrations deployed; integration test asserts one row per request |
| Durable idempotency and recovery endpoints | Verified | Live integration test and E2E flow |
| Server-only ledger account resolution | Verified | Integration test resolves recipient via signed token; no account IDs in API responses |
| Advisory-lock serialisation of app-originated ledger writes | Verified | Live integration test exercises locked funding/settlement paths |
| Unit tests (money + receipt verification) | Verified | 35 tests passed across 4 files |
| Integration tests against live cluster + PostgreSQL | Verified | 3 tests passed across 2 files |
| E2E tests, including a full fund → send → receipt journey | Verified | 3 tests passed across 2 files |
| Typecheck, lint, production build | Verified | All clean |
| README, API docs, invariant report | Verified | `README.md`, `docs/api.md`, `docs/release-2-financial-invariant-report.md` |

## Live workflow evidence

- Cluster reachable on `http://localhost:8001`–`8005`; leader discovered at
  runtime (observed `node-1`, term `776`). No leader is hardcoded.
- Tenant `nexuspay` was registered on all five nodes with
  `scripts/ensure-raftline-tenant.ps1`. Without a registered tenant, Raftline
  returns 429 on settlement and Nexus Pay correctly preserves the payment as
  unresolved rather than reporting success.
- PostgreSQL `nexus_pay` on `localhost:5433`, 4 migrations applied.
- E2E journey created two customers, verified both wallets, added ₹5,000.00 of
  simulated sandbox funds, sent ₹500.00, verified the sender's receipt and the
  recipient's received entry, then cleaned up both users and ledger accounts.
- Integration test replayed the same settlement idempotency key directly
  against Raftline: `isIdempotentReplay: true`, recipient balance unchanged, one
  intent and one transaction row in PostgreSQL.

## Unverified

- **Leader failover mid-payment.** The adapter is designed to rediscover the
  leader and preserve unknown outcomes, but no failure was injected during this
  release's verification. Release 1 chaos evidence covers cluster failover, not
  an in-flight Release 2 payment.
- **Concurrent writes from a second application.** Advisory locks only
  serialise Nexus Pay's own ledger calls. An external writer using the same
  Raftline tenant is outside the tested boundary.
- **Non-INR wallets.** Funding and settlement are deliberately restricted to
  active INR wallets; multi-currency is not verified or enabled.
- **Prefix / fuzzy recipient search.** Intentionally absent to prevent account
  enumeration; only exact handle, email or phone is supported.

## Blocked

- None. The missing tenant registration encountered during integration testing
  was a runtime cluster configuration issue, resolved by registering the tenant
  on all nodes. The companion script is included for repeatability.

## Deferred (deliberately out of scope)

- Operator reconciliation console for `RECONCILIATION_REQUIRED` rows (the
  durable state and reconciliation service exist; no admin UI).
- Real bank, UPI or card funding and withdrawals.
- Notifications beyond the placeholder in the customer header.
- Full accessibility audit and localisation beyond `en-IN` formatting.
- Release 3 features; not started.

## Reproduce

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
./scripts/ensure-raftline-tenant.ps1
pnpm test:integration
pnpm test:e2e
```
