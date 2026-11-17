# Nexus Pay

Consumer wallet, P2P payments and personal finance app backed by a live five-node **Raftline** cluster.

> **Sandbox only.** Funding is **SIMULATED SANDBOX FUNDING**. No bank, UPI, card or real-money integration.

## Core rules

- Raftline is the only financial ledger; PostgreSQL holds metadata only.
- Success requires a verified committed receipt — never HTTP acceptance alone.
- Ambiguous outcomes stay unresolved; no new idempotency key after a timeout.

## Quick start

```powershell
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm --filter @nexus/web dev
```

Requires PostgreSQL (`localhost:5433`) and Raftline nodes on ports 8001–8005. Register the tenant with `./scripts/ensure-raftline-tenant.ps1`. Configure `apps/web/.env.local` from `apps/web/.env.example`.

## Areas

| Area | Routes |
| --- | --- |
| Wallet / payments | `/home`, `/wallet`, `/wallet/add-money`, `/send`, `/receive`, `/transactions` |
| Social | `/contacts`, `/requests`, `/groups`, `/groups/[groupId]/settle` |
| Finance | `/insights`, `/budgets`, `/savings`, `/scheduled`, `/calendar`, `/statements` |
| Admin | `/control` (isolated RBAC: SUPER_ADMIN / OPERATOR / VIEWER; chaos disabled by default) |

## Tests

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test:unit
pnpm test:integration      # live cluster + PostgreSQL
pnpm exec playwright test --config playwright.prod.config.ts
```

## Docs

- [API](docs/api.md) · [Environment](docs/environment-setup.md) · [Raftline integration](docs/raftline-integration.md)
- [Nexus Control](docs/nexus-control.md) · [Runbooks](docs/nexus-control-runbooks.md) · [Release 5 report](docs/release-5-report.md)
- Earlier releases: [R2](docs/release-2-report.md) · [R3](docs/release-3-report.md) · [R4](docs/release-4-report.md)
