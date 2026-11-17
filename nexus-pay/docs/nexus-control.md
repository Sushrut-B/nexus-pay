# Nexus Control — Architecture and Operations Guide

## 1. Architecture

Nexus Control is an isolated administrative area of the existing Next.js
application:

- Customer app: `/home`, `/wallet`, `/send`, `/groups`, `/insights`, etc.
- Admin app: `/control/**` with its own layout, navigation and session cookie.
- Backend: `/api/control/**` with server-side RBAC and structured audit.
- Raftline: five-node cluster, accessed only from server-side adapters.
- Storage: PostgreSQL for admin identities, observations, alerts, chaos
  operations, reconciliation cases and audit records.

Raftline remains authoritative for settlement. Nexus Control observes and
manages infrastructure; it never modifies balances or creates payments except
via the existing verified payment engine.

## 2. Administrative authentication and RBAC

Separate identity store (`admin_users`, `admin_sessions`) with hashed tokens and
Argon2id password hashes. The admin session cookie is `np_control_session`
(HTTP-only, SameSite=Lax, Secure when `APP_URL` is https). Customer sessions
cannot access control endpoints.

| Role | Read | Chaos inject/heal | Reconciliation | Admin management |
| --- | --- | --- | --- | --- |
| SUPER_ADMIN | yes | yes | yes | yes |
| OPERATOR | yes | yes | yes | no |
| VIEWER | yes | no | no | no |

Permissions are enforced in `lib/control/auth.ts` and in every API route through
`requireControl(permission)`. Denials are audited.

Bootstrap: set `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_USERNAME` and
`ADMIN_BOOTSTRAP_PASSWORD` (min 12 chars) before first start. The bootstrap runs
only when no administrators exist. No default credentials are shipped.

## 3. Raftline integration

Verified endpoints and contracts are documented in
`docs/nexus-control-assessment.md`. The adapter (`lib/control/raftline-adapter.ts`)
uses dynamic leader discovery and sends `Authorization: Bearer` / `X-API-Key`
when Raftline has an API key configured.

Sampling: no SSE or WebSocket endpoint exists, so the collector polls
`/v1/cluster/status` for all five nodes, stores a `cluster_snapshot` plus one
`node_observation` per node, and records leader changes in `leader_transitions`.

Health rules:
- 0 reachable → UNKNOWN
- reachable < quorum (floor(n/2)+1) → QUORUM_LOST
- no leader reported → NO_LEADER
- term change within 5 minutes → RECOVERING
- any node unavailable → DEGRADED
- otherwise → HEALTHY

Unexposed values (replication lag, uptime, heartbeat timestamps) show
`Not available`; nothing is invented.

## 4. Monitoring and polling

Default interval: `NEXUS_CONTROL_POLL_INTERVAL_MS` (30s, minimum 5s). The UI
polls `/api/control/overview` every 30s, uses a 90s stale threshold, and shows
the last stored snapshot when probes fail. Metrics are Nexus-observed samples,
labelled `NEXUS_OBSERVED`; gaps are not interpolated.

## 5. Chaos engineering safety

Chaos is disabled by default (`NEXUS_CONTROL_CHAOS_ENABLED=false`). When enabled:

- OPERATOR or SUPER_ADMIN only.
- Mandatory reason, explicit confirmation dialog, rate limit (5/min).
- Duplicate identical operation within 30s is blocked.
- Destructive scenarios are blocked when healthy nodes <= quorum.
- `PARTITION_MAJORITY` requires `NEXUS_CONTROL_ALLOW_QUORUM_LOSS=true` in an
  isolated environment.
- `KILL_LEADER` must target the currently observed leader.
- No automatic retry after an uncertain response; every attempt is audited.

Healing distinguishes request accepted, node reachable, node recovered and node
caught up. Only a heal response plus subsequent observations can support a
recovery conclusion.

Supported scenarios come directly from Raftline's `ChaosScenario` enum:
KILL_LEADER, PARTITION_NODE, PARTITION_MINORITY, PARTITION_MAJORITY,
ASYMMETRIC_PARTITION, PACKET_JITTER_STORM, FREEZE_NODE, HEAL_ALL, CUSTOM.

## 6. Payment investigation and reconciliation

Operators read existing `PaymentIntent` records with masked idempotency keys and
wallet references. Reconciliation queries Raftline with
`getTransaction(paymentRef)` and stores the evidence. Resolution requires a
matching settled/rejected receipt; only then may the existing
`reconcilePaymentIntent` path update application state. No new idempotency key
or second debit can be created. See `docs/nexus-control-runbooks.md`.

## 7. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_CONTROL_ENABLED` | `true` | Disables all control routes and APIs |
| `NEXUS_CONTROL_CHAOS_ENABLED` | `false` | Enables real chaos operations |
| `NEXUS_CONTROL_ALLOW_QUORUM_LOSS` | `false` | Allows majority-partition tests |
| `NEXUS_CONTROL_POLL_INTERVAL_MS` | `30000` | UI poll interval hint |
| `NEXUS_CONTROL_ADMIN_SESSION_HOURS` | `8` | Admin session lifetime |
| `ADMIN_BOOTSTRAP_EMAIL/USERNAME/PASSWORD` | none | One-time super-admin bootstrap |
| `RAFTLINE_API_KEY` | none | Sent to chaos endpoints when configured |

## 8. Development and deployment (Windows / PowerShell)

Start PostgreSQL, then the Raftline cluster, then Nexus Pay:

```powershell
# PostgreSQL (Docker Desktop)
docker compose up -d

# Raftline five-node development cluster
cd C:\Sushrut\projects\Raftline
.\scripts\start-5node-cluster.ps1

# Nexus Pay + Nexus Control
cd C:\Sushrut\projects\nexus-pay
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Open http://localhost:3000 for Nexus Pay and http://localhost:3000/control for
Nexus Control. Use the bootstrap administrator credentials from your environment.

Production: set `APP_URL=https://...`, remove bootstrap variables after first
login, leave chaos disabled, and run `pnpm build && pnpm start`.

## 9. Known limitations

- No native replication lag, uptime or heartbeat metric from Raftline.
- No native event stream; transitions are sampled observations with explicit
  source labelling.
- Chaos targets the node that receives the request; `peer` selects a peer link.
- Multi-instance scheduler/worker deployment requires the external scheduler
  script; atomic claiming already supports concurrency.
