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
