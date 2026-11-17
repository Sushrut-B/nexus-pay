# Nexus Pay — Release 5 Implementation Report (Nexus Control)

Date: 17 November 2026
Scope: Release 5 only. Release 6 is not started.

## Features implemented

- Isolated `/control` application with dark sidebar, light workspace and its own
  administrator login.
- Live cluster overview: health, nodes, leader, followers, term, quorum,
  commit/applied index, stale indicators, alerts and recent activity.
- Cluster status and five-node topology/nodes with per-node detail, sampled
  history and chaos state.
- Leader election timeline including re-elections observed via term changes.
- Chaos engineering console using the real Raftline inject/heal endpoints with
  confirmation, mandatory reason, rate limiting and safety rules.
- Payment operations investigation with masked keys and wallet references.
- Evidence-based reconciliation with no replay or new idempotency keys.
- Nexus-observed metrics and availability samples.
- Deduplicated alerts with acknowledgement.
- Append-only administrative audit log and structured diagnostics.
- RBAC: SUPER_ADMIN, OPERATOR, VIEWER.

## Architecture changes

Added a separate admin identity/session boundary (`np_control_session`), no
changes to customer sessions. All Raftline traffic goes through
`lib/control/raftline-adapter.ts`. Monitoring writes observations to PostgreSQL
through `lib/control/collector.ts`; these are observations, not a ledger.

## Database migration

`20261117135105_release5_nexus_control`: `admin_users`, `admin_sessions`,
`admin_audit_logs`, `cluster_snapshots`, `node_observations`,
`leader_transitions`, `chaos_operations`, `chaos_operation_events`,
`operational_alerts`, `reconciliation_cases`, `reconciliation_attempts`.

## New API endpoints

`/api/control/session`, `/auth/login`, `/auth/logout`, `/overview`,
`/cluster/status`, `/nodes`, `/nodes/[nodeId]`, `/leader-history`, `/metrics`,
`/payments`, `/payments/[id]`, `/reconciliation` (+ open/investigate/resolve),
`/chaos/operations`, `/chaos/inject`, `/chaos/heal`, `/chaos/[id]`, `/alerts`
(+ acknowledge), `/audit`, `/diagnostics`, `/admin`.

## Actual Raftline endpoints integrated

- `GET /v1/cluster/status`
- `GET /v1/chaos/status`
- `GET /v1/chaos/verify`
- `POST /v1/chaos/inject`
- `POST /v1/chaos/heal`
- receipt lookup via the existing API client (`getTransaction`) for reconciliation

## Backend capabilities unavailable

No native replication lag, uptime, heartbeat timestamp, SSE/WebSocket stream or
historical metrics. Unexposed values display `Not available`. Observed metrics
are explicitly labelled `NEXUS_OBSERVED`.

## Security and RBAC

Server-side role checks, CSRF on mutations, rate limiting, hashed admin tokens,
Argon2id passwords, secure cookies when `APP_URL` is https, append-only audit,
masked sensitive fields, no browser-to-Raftline access, no secrets in bundles.

## Tests executed

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | 0 warnings |
| `pnpm build` | Passed — 44 route groups |
| `pnpm test:unit` | 53 passed across 8 files (3 new control tests) |
| `pnpm test:integration` | 36 passed across 7 files (4 new live control tests) |
| Release 5 E2E | 1 passed — admin login and all control screens |
| Manual acceptance | Leader failure drill + real payment + reconciliation + audit |

Manual acceptance evidence:
- `KILL_LEADER` injected into the observed leader; term changed 800 → 802 and a
  re-election transition was recorded from real status observations.
- Node healed; cluster returned to HEALTHY with 5/5 nodes and chaos inactive.
- A post-failover payment settled with a 10,000 paise debit and a real reference.
- Reconciliation retrieved a `SETTLED` receipt from Raftline, resolved the case,
  created no additional payment intent, and audit recorded all actions.
- RBAC verified live: VIEWER blocked from chaos and admin management (403),
  OPERATOR allowed chaos but blocked from admin management (403), customer and
  unauthenticated access blocked.

## Known limitations

- Chaos operations target the node receiving the request; multi-instance
  deployments should use the external scheduler/worker pattern.
- Production chaos remains disabled by default; bootstrap credentials must be
  removed after the first administrator is created.
- Election timing is sampled, not provided by Raftline.
- No MFA provider is configured; no simulated MFA is claimed.

## Commands

```powershell
# Infrastructure
cd C:\Sushrut\projects\nexus-pay
docker compose up -d
cd C:\Sushrut\projects\Raftline
.\scripts\start-5node-cluster.ps1

# Application
cd C:\Sushrut\projects\nexus-pay
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev      # http://localhost:3000 and http://localhost:3000/control

# Verification
pnpm typecheck; pnpm lint; pnpm build
pnpm test:unit
pnpm test:integration
pnpm exec playwright test --config playwright.prod.config.ts
```
