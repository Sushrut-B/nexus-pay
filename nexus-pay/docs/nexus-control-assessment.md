# Nexus Control — Pre-Implementation Technical Assessment

Date: 17 November 2026

## 1. Existing architecture

Nexus Pay is a single Next.js 15 App Router workspace (`apps/web`) with shared
packages (`api-client`, `database`, `shared-types`, `ui`, `validation`), a
PostgreSQL database and the Raftline five-node cluster. Releases 1–4 are present
and green: 50 unit, 32 integration and 6 E2E tests pass.

## 2. Current Raftline integration

`packages/api-client` provides leader discovery, validated account reads and
creation, simulated funding and idempotent internal-book settlement. All
financial traffic is server-side. `getTransaction(ref)` reads a committed
receipt by idempotency key or payment reference, which is the only supported
reconciliation lookup.

Raftline HTTP contract verified from source:

| Endpoint | Response / request |
| --- | --- |
| `GET /v1/cluster/status` | `{ nodeId, role, term, leaderId, commitIndex, lastApplied, lastLogIndex, lastLogTerm }` |
| `GET /v1/cluster/nodes` | `{ localNodeId, peers, clusterSize, quorum }` |
| `GET /v1/chaos/status` | `{ nodeId, role, isPaused, isolatedPeers, peerDelaysMs, peerDropRates, recentEvents[] }` |
| `GET /v1/chaos/verify` | validation probe with leader/term/checks/summary |
| `POST /v1/chaos/inject` | body `{ scenario, target?, peer?, delayMs?, dropRate? }`; returns `{ status: INJECTED, eventId, scenario, target, details, timestamp }`; API key required when configured |
| `POST /v1/chaos/heal` | query `?peer=<id>` or `?all=true`; API key required when configured |

`ChaosScenario` enum: `KILL_LEADER`, `PARTITION_NODE`, `PARTITION_MINORITY`,
`PARTITION_MAJORITY`, `ASYMMETRIC_PARTITION`, `PACKET_JITTER_STORM`,
`FREEZE_NODE`, `HEAL_ALL`, `CUSTOM`.

Chaos injection is executed by the node that receives the request; the `peer`
parameter selects a peer relationship, not an arbitrary remote node. `KILL_LEADER`
must therefore be posted to the currently discovered leader.

## 3. Authentication and role management

Customers use `np_session` with hashed tokens in `user_sessions`. There is no
administrative identity, RBAC or admin audit trail. This release adds an
isolated admin identity store and session cookie (`np_control_session`).

## 4. Operational endpoints

Available: cluster status, cluster nodes, chaos status/verify/inject/heal.
There is no SSE/WebSocket event stream, no native replication-lag metric, no
historical metrics API, and no native uptime metric. Nexus Control will poll
status endpoints and store its own observations; unexposed values will show
`Not available`.

## 5. Payment reconciliation support

PaymentIntents store idempotency keys, statuses, rejection codes and receipt
verification state. `getTransaction(ref)` can retrieve the authoritative
Raftline receipt without resubmitting a payment. Reconciliation can compare
metadata with that receipt; it must never create a new key or debit.

## 6. Proposed Nexus Control architecture

- Separate `/control` route area with its own layout and admin-only middleware.
- Isolated admin auth (SUPER_ADMIN / OPERATOR / VIEWER) with HTTP-only sessions,
  CSRF and rate limiting.
- Server-side `raftline-control` adapter wrapping the verified endpoints.
- PostgreSQL observation store: cluster snapshots, node observations, leader
  transitions, chaos operations, alerts, reconciliation cases and admin audit.
- Protected `/api/control/**` APIs with server-side RBAC.
- No changes to customer flows, no second financial ledger, no direct browser
  access to Raftline.

## 7. Missing backend capabilities

- No native replication lag, uptime, heartbeat timestamp or event stream.
- No native historical metrics; Nexus Control must collect samples itself.
- No operator API to list arbitrary payments; reconciliation uses existing
  application records plus the receipt lookup.
- Chaos operations require the Raftline API key; bootstrap via environment
  variable. Production chaos is disabled by default.
