# Raftline Integration

Verified against the live Raftline five-node cluster on 17 November 2026.

## 1. Integration goals

Nexus Pay uses Raftline as the authoritative account and balance ledger. The
integration must:

- Discover the current leader after elections and failovers.
- Read and create customer accounts without overwriting existing accounts.
- Verify every write by reading it back from the cluster.
- Distinguish definitive failures from ambiguous financial outcomes.
- Never guess or cache a balance in PostgreSQL.
- Avoid blind retries that could duplicate or overwrite financial records.

Raftline is not mocked in integration testing. The adapter is live-tested against
the local cluster.

## 2. Cluster topology

| Node | HTTP REST | gRPC |
| --- | --- | --- |
| `node-1` | `http://localhost:8001` | `9001` |
| `node-2` | `http://localhost:8002` | `9002` |
| `node-3` | `http://localhost:8003` | `9003` |
| `node-4` | `http://localhost:8004` | `9004` |
| `node-5` | `http://localhost:8005` | `9005` |

Leadership is dynamic. At the latest live verification the leader was `node-2`,
term `733`. That observation is evidence, not configuration; the adapter must
always discover the leader at runtime.

## 3. Adapter layout

| File | Responsibility |
| --- | --- |
| `packages/api-client/src/config.ts` | Environment parsing, URL validation and mode selection. |
| `packages/api-client/src/http.ts` | Fetch transport, timeouts, API key header and manual redirects. |
| `packages/api-client/src/leader.ts` | Cluster probing, leader selection, cache and coalesced discovery. |
| `packages/api-client/src/accounts.ts` | Existing-account reads, official create, KV fallback and verification. |
| `packages/api-client/src/errors.ts` | Typed Raftline errors and ambiguity metadata. |
| `apps/web/lib/wallet/service.ts` | Wallet state transitions, database claim and customer-facing overview. |

## 4. Configuration

Canonical settings:

```dotenv
RAFTLINE_NODE_1_URL="http://localhost:8001"
RAFTLINE_NODE_2_URL="http://localhost:8002"
RAFTLINE_NODE_3_URL="http://localhost:8003"
RAFTLINE_NODE_4_URL="http://localhost:8004"
RAFTLINE_NODE_5_URL="http://localhost:8005"
RAFTLINE_TENANT_ID="nexuspay"
RAFTLINE_TIMEOUT_MS="5000"
RAFTLINE_LEADER_CACHE_TTL_MS="2000"
RAFTLINE_ACCOUNT_CREATE_MODE="auto"
RAFTLINE_API_KEY=""
```

Supported alternatives and aliases:

| Setting | Alternatives |
| --- | --- |
| Node URLs | `RAFTLINE_BASE_URLS`, a comma-separated list. |
| Request timeout | `RAFTLINE_REQUEST_TIMEOUT_MS`. |
| Create mode | The adapter also accepts the legacy key `RAFTLINE_ACCOUNT_CREATION_MODE` and legacy values `api` and `kv_compat`, mapped to `official` and `kv`. Prefer the canonical key and values. |

Modes:

| Mode | Behavior |
| --- | --- |
| `auto` | Official create, read-back, then verified KV fallback if the account is confirmed absent. |
| `official` / `api` | Official create and read-back only. Fails if the write did not persist. |
| `kv` / `kv_compat` | Write the verified account record through the generic KV endpoint. |

`RAFTLINE_TENANT_ID` must be 1-64 characters of letters, numbers, underscores or
hyphens. Account IDs must be 1-80 characters of letters, numbers, dots,
underscores or hyphens.

### 4.1 Tenant registration (required for settlement)

Raftline applies a per-tenant token bucket to the settlement endpoint. A tenant
that is not registered on the current leader receives HTTP `429` for every
settlement, even when funding and account reads succeed. Nexus Pay treats that
as a definitive "busy" outcome: it returns the intent to an attemptable state
and never reports success.

Register the configured tenant on **each** node after starting the cluster:

```powershell
./scripts/ensure-raftline-tenant.ps1
```

This is safe to re-run. Leader changes do not require re-registration once all
five nodes have the tenant. If payments return "The ledger is busy" repeatedly,
verify the tenant with `GET /v1/dbaas/tenants` on the current leader.

## 5. Leader discovery

Discovery requests `GET /v1/cluster/status` from all configured nodes in
parallel with a three-second probe budget. The adapter:

1. Selects a node whose role is `LEADER`.
2. Otherwise selects the node whose `nodeId` matches a reported `leaderId`.
3. Throws `UNAVAILABLE` if no reachable node reports a leader.
4. Caches the location for `RAFTLINE_LEADER_CACHE_TTL_MS`.
5. Coalesces concurrent discovery requests into one probe set.

Every payment request goes to the discovered leader with redirects disabled.
On HTTP `307` or `308`, or a response containing a not-leader error, the cache is
invalidated and discovery is retried, up to three attempts per call.

Observed behavior:

- A POST sent to a follower can return `307` toward the leader.
- Some GET paths on a follower returned HTTP `500` instead of a redirect.
- Cluster status remains the reliable source for leader selection.
- Polling all nodes avoids trusting a stale local list.

## 6. Official payment API

### Read an account

```http
GET /v1/payments/account?id=<accountId>&tenantId=<tenantId>
```

- `200`: parse the account JSON.
- `404`: account does not exist; return `null`.
- Other status: `UNAVAILABLE` or a mapped response error.

Account fields consumed:

```json
{
  "accountId": "np_cm3u3q4x90000abc123_inr",
  "tenantId": "nexuspay",
  "currency": "INR",
  "balanceCents": 0,
  "reservedCents": 0,
  "availableBalanceCents": 0,
  "status": "ACTIVE",
  "createdAt": 1763331234567,
  "updatedAt": 1763331234567,
  "metadata": {}
}
```

If `availableBalanceCents` is absent, the adapter computes
`balanceCents - reservedCents`. Malformed payloads raise `BAD_RESPONSE`.

### Create an account

```http
POST /v1/payments/accounts
Content-Type: application/json

{
  "accountId": "np_cm3u3q4x90000abc123_inr",
  "tenantId": "nexuspay",
  "currency": "INR",
  "initialBalanceCents": 0,
  "metadata": {
    "source": "nexus-pay",
    "walletId": "cm3u3q4x90001abc456"
  }
}
```

- `200` or `201`: advisory success; read-back is still required.
- `5xx`: ambiguous; do not retry blindly.
- Other status: definitive provisioning failure.

## 7. The account creation defect

Raftline's settlement engine builds the payment account create idempotency key
from the logical client identity plus `System.nanoTime()`. After a process
restart, a later request can reuse a previously recorded key. In that situation
the engine can return success while the new account is never persisted.

Implication: an HTTP `201` from the official create endpoint is not proof of
creation. Nexus Pay therefore:

1. Reads first and never overwrites an existing account.
2. Sends at most one official create attempt per provisioning claim.
3. Reads back at `0 ms`, `200 ms` and `500 ms`.
4. Falls back only when the account is still confirmed absent.
5. Moves to reconciliation when it cannot prove either outcome.

Reference implementation:

- `raftline-core/.../PaymentSettlementEngine.java`
- `raftline-api/.../RaftHttpServer.java`

## 8. Generic KV compatibility path

Raftline's generic replicated store accepts arbitrary keys through:

```http
PUT /v1/kv/<url-encoded-key>
Content-Type: application/json
X-Client-Id: <unique request identity>
X-Sequence-Number: 1

{
  "accountId": "...",
  "tenantId": "nexuspay",
  "currency": "INR",
  "balanceCents": 0,
  "reservedCents": 0,
  "status": "ACTIVE",
  "createdAt": 1763331234567,
  "updatedAt": 1763331234567,
  "metadata": {
    "source": "nexus-pay",
    "walletId": "..."
  }
}
```

Key format:

```text
pay:acc:<tenant>:<accountId>
```

The payments read endpoint recognizes a valid account record at this key, so a
fallback write can be verified through the normal account API.

The adapter uses:

- A fresh `X-Client-Id` of
  `nexuspay-provision-<UUID>` for each fallback attempt.
- `X-Sequence-Number: 1`.

A unique client identity is necessary. Reusing a stable client ID can hit the
same stale session deduplication behavior that causes the create defect.

### Compatibility caveats

- Direct KV writes bypass part of the payment/tenant manager path. The key is
  explicitly namespaced under the configured tenant, but the fallback is still a
  controlled compatibility measure.
- Do not expose generic KV access to browser clients.
- Do not use KV fallback for normal payment operations.
- `kv` mode is intended for controlled operation while the official create
  defect is unresolved.
- Every fallback write must be read back and currency-checked before the local
  wallet becomes `ACTIVE`.

## 9. Provisioning algorithm

```text
ensureAccount(accountId, currency, metadata):
    account = GET /v1/payments/account
    if account exists:
        verify tenant and currency
        return existing, created=false

    if mode == kv:
        return provisionViaKv()

    if mode == official:
        POST official create
        verified = readBack(0, 200, 500)
        if not verified: raise PROVISIONING_FAILED/ambiguous
        verify tenant and currency
        return official, created=true

    # auto
    POST official create
    verified = readBack(0, 200, 500)
    if verified:
        verify tenant and currency
        return official, created=true

    if the account is confirmed absent:
        return provisionViaKv()

    raise the read-back exception
```

Important properties:

- Existing accounts are adopted, not recreated.
- Currency and tenant mismatches raise `CONFLICT`.
- 5xx and timeout failures on mutating calls are marked ambiguous.
- Read-back errors are not ignored.
- The database wallet claim prevents concurrent provisioning attempts in one
  instance; the deterministic account ID and read-before-write limit cross-
  instance risk.

## 10. Wallet state mapping

| Outcome | Wallet status |
| --- | --- |
| Existing or created account verified | `ACTIVE` |
| Definitive non-ambiguous provisioning failure | `FAILED` |
| Timeout, 5xx, unverifiable write or unknown outcome | `RECONCILIATION_REQUIRED` |
| `PROVISIONING` lease older than two minutes | Reclaimable by a new request |
| Active local wallet but account missing on read | Wallet remains `ACTIVE`; overview reports `ACCOUNT_NOT_FOUND` |

A wallet becomes `ACTIVE` only after the account read-back succeeds and tenant
and currency are checked.

## 11. Error model

| Code | Meaning | Ambiguous by default |
| --- | --- | --- |
| `UNAVAILABLE` | Cluster or node unreachable | No for GET; mutating transport failures are marked ambiguous. |
| `TIMEOUT` | Request budget expired | No for GET; yes for mutating calls. |
| `NOT_LEADER` | Node rejected or redirected the request | No; cache is invalidated and rediscovered. |
| `BAD_RESPONSE` | Unparseable or unexpected payload | No. |
| `CONFLICT` | Tenant or currency mismatch | No. |
| `PROVISIONING_FAILED` | Definitive create failure | No, unless wrapped as an ambiguous failure. |
| `AMBIGUOUS` | Mutating write may or may not have committed | Yes. |
| `CONFIGURATION` | Invalid integration configuration | No. |

Customer responses never expose raw ledger payloads. The API maps ledger
problems to safe `RAFTLINE_UNAVAILABLE` or `RAFTLINE_TIMEOUT` messages.

## 12. Verification evidence

Automated live integration:

```powershell
pnpm test:integration
```

Covered:

- Discover a current leader from the live five-node cluster.
- Provisions an account under tenant `nexuspay-test`.
- Verifies account ID, tenant, INR currency and zero available balance.
- Reads the account back through the payments API.
- Calls `ensureAccount` again and verifies `mode=existing` with no new write.
- Verifies a missing account returns `null`.
- Deletes the test account through the current leader's KV endpoint.

Manual smoke evidence from development:

- Created a fallback account under tenant `nexuspay` in `kv` mode.
- Read back the account with zero balance.
- Deleted it through the current leader.
- Confirmed the account was no longer readable.

The Playwright customer journey also provisions an INR account, observes
`ACTIVE` and `₹0.00`, then deletes the local user and ledger account during
teardown.

## 13. Operational runbook

### Check the cluster

```powershell
1..5 | ForEach-Object {
  try {
    Invoke-RestMethod "http://localhost:800$_/v1/cluster/status" |
      Select-Object nodeId, role, term, leaderId
  } catch {
    Write-Host "node-$_ unavailable"
  }
}
```

### Read an account

```powershell
$accountId = "np_<userId>_inr"
Invoke-RestMethod "http://localhost:8001/v1/payments/account?id=$accountId&tenantId=nexuspay"
```

If the seed node is not the leader, use the node whose status reports `LEADER`.

### Handle a reconciliation wallet

1. Do not retry blindly in a loop.
2. Read the account from the current leader.
3. Compare tenant and currency.
4. If the account exists and matches, retry verification once so the wallet can
   become `ACTIVE`.
5. If it does not exist and the previous write was ambiguous, investigate before
   creating again.
6. Record the investigation outcome in the audit trail or an incident log.

### Delete an account

Only delete test accounts. Financial records require an approved retention and
reconciliation process.

```powershell
$key = [uri]::EscapeDataString("pay:acc:nexuspay:$accountId")
Invoke-RestMethod "http://localhost:8002/v1/kv/$key" -Method Delete `
  -Headers @{
    "X-Client-Id" = "manual-cleanup-$([guid]::NewGuid())"
    "X-Sequence-Number" = "1"
  }
```

Use the current leader URL, not a hard-coded node.

## 14. Known limitations

- The official account-create defect is a Raftline issue; the fallback is a
  compatibility measure in Nexus Pay.
- Fallback records may not participate in every payment manager index until the
  official API creates them.
- The adapter does not implement an outbox or background reconciliation worker.
- Reconciliation is customer/operator initiated in Release 1.
- There is no automated chaos or leader-failover test in this repository.
- Balance freshness is request-time; there are no ledger event subscriptions.
- Raftline authentication is optional; when enabled, set `RAFTLINE_API_KEY`.
