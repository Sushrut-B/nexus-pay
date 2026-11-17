# Nexus Pay

Nexus Pay is a consumer wallet and personal-payments application backed by the
live five-node **Raftline** cluster. Release 2 adds simulated sandbox funding,
P2P transfers, a receive/QR flow, transaction history, verified PDF receipts and
stronger financial-invariant handling.

> **Sandbox only.** All funding is explicitly labelled **SIMULATED SANDBOX
> FUNDING**. There is no bank, UPI, card or real-money integration, and no
> regulatory or real-world value is implied.

## What is authoritative

- **Raftline** is the only ledger. Balances are read live from it; PostgreSQL
  never stores a balance that the UI presents as current.
- A payment, funding credit or receipt is reported as successful **only after a
  committed Raftline receipt is verified** against the original instruction.
- An ambiguous outcome stays `UNKNOWN` / `RECONCILIATION_REQUIRED`. It is never
  reported as success, and a new idempotency key is never generated after a
  timeout.

## Technology

- Next.js 15 App Router, React 19, TypeScript, Tailwind CSS
- TanStack Query for live balance refresh
- Prisma 6 + PostgreSQL
- Raftline REST API (leader discovery, idempotent settlement, committed receipts)
- Vitest (unit/integration), Playwright (E2E), pdf-lib and qrcode

## Quick start

```powershell
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm --filter @nexus/web dev
```

Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the database
and Raftline settings first. The cluster must be running on ports 8001–8005 and
the configured tenant must be registered on every node:

```powershell
./scripts/ensure-raftline-tenant.ps1
```

See [docs/environment-setup.md](docs/environment-setup.md) for environment
details and [docs/raftline-integration.md](docs/raftline-integration.md) for the
ledger contract.

## Customer routes (Release 2)

| Route | Purpose |
| --- | --- |
| `/home` | Live balance, freshness, quick actions, monthly summary, recent activity |
| `/wallet` | Live balances, reserved/ledger totals, funding and wallet activity |
| `/wallet/add-money` | Three-step simulated funding wizard with recovery |
| `/send` | Recipient lookup, amount, review, verified result |
| `/receive` | Payment handle, shareable link and QR code |
| `/pay/[username]` | Payment link landing page; never executes a transfer automatically |
| `/transactions` | Filters, search, date range, sorting and pagination |
| `/transactions/[paymentRef]` | Verified detail, timeline, parties and PDF receipt |

Legacy `/add-money`, `/history` and `/history/[id]` redirect to their canonical
Release 2 routes.

## API

See [docs/api.md](docs/api.md) for every route, ownership rules and error
categories. All financial mutations require an authenticated session, a CSRF
header and a server-resolved wallet/recipient; client-submitted ledger account
IDs are never trusted.

## Tests and reports

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:integration   # requires the live cluster and PostgreSQL
pnpm test:e2e           # Playwright starts the dev server if needed
```

- [Release 2 report](docs/release-2-report.md) — verified, unverified, blocked
  and deferred items.
- [Financial invariant report](docs/release-2-financial-invariant-report.md) —
  how money safety is enforced and tested.
- [Release 1 test report](docs/release-1-test-report.md) — baseline evidence.

## Release 3 — social payments

Release 3 adds contacts, payment requests, shared expense groups, balance
calculation, debt simplification, verified Settle Up payments, a group activity
feed and in-app notifications. It reuses the Release 2 payment engine for every
monetary transfer; social records are accounting metadata, not a second ledger.

| Route | Purpose |
| --- | --- |
| `/contacts`, `/contacts/[contactId]` | Find, add, manage and view contacts |
| `/requests`, `/requests/[id]` | Create, accept, decline, cancel and pay money requests |
| `/groups` | Create and browse social expense groups |
| `/groups/[groupId]` | Members, expenses, balances, suggested payments and activity |
| `/groups/[groupId]/settle` | Pay group dues through the verified payment engine |

Key rules:

- Accepting a request never moves money; only the explicit pay action does.
- Splits use integer paise with deterministic largest-remainder allocation.
- Only a verified successful payment reduces group dues; partial payments are
  supported and overpayments are rejected server-side.
- Repeated settlement confirmations reuse one durable client request id, so no
  second debit or balance reduction can occur.

Reports:

## Release 5 — Nexus Control

An isolated administrative control plane at **`/control`** for the live Raftline
cluster: dynamic leader discovery, node health, leader-election observations,
real chaos operations with safety controls, payment investigation, evidence-based
reconciliation, metrics, alerts, audit and diagnostics. Separate admin RBAC
(SUPER_ADMIN / OPERATOR / VIEWER) protects every `/api/control/**` endpoint.
Chaos is disabled by default.

- [Nexus Control guide](docs/nexus-control.md)
- [Operational runbooks](docs/nexus-control-runbooks.md)
- [Pre-implementation assessment](docs/nexus-control-assessment.md)
- [Release 5 report](docs/release-5-report.md)

## Release 4 — personal finance intelligence

Release 4 adds insights, categorization, budgets, savings goals, scheduled
payments, recurring detection, a calendar and statements. All analytics are
derived from verified Raftline transactions; Raftline remains the only source
of truth.

| Route | Purpose |
| --- | --- |
| `/insights`, `/insights/spending` | Financial overview, cash flow and spending analytics |
| `/transactions/categories` | Categorize transactions and manage personal rules |
| `/budgets` | Category budgets with threshold alerts |
| `/savings` | Savings goals with manual planning contributions |
| `/scheduled`, `/scheduled/recurring` | Scheduled payments, execution history and detected patterns |
| `/calendar` | Upcoming payment, budget and goal dates |
| `/statements` | Generate and download PDF/CSV statements |

Important boundaries:

- Analytics exclude funding, failed/unconfirmed payments and personal transfers
  or group obligations from "spending".
- Budgets track limits; they never reserve funds.
- Savings goals track progress; contributions are planning events, not transfers.
- Scheduled payments reuse the Release 2 idempotent payment engine with a
  stable execution key; no bank mandate or UPI AutoPay is involved.
- Statements contain only verified records; unavailable balances are labelled.

Reports:

- [Release 4 report](docs/release-4-report.md)
- [Financial calculation report](docs/release-4-financial-report.md)
- [Scheduled execution reliability report](docs/release-4-scheduling-report.md)

- [Release 3 report](docs/release-3-report.md) — completion status and evidence.
- [Financial calculation report](docs/release-3-financial-calculation-report.md)
  — split/balance rules and test results.
- [API documentation](docs/api.md) — all Release 1–3 endpoints.
