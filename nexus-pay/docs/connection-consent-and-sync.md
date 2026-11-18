# Connection lifecycle, consent and synchronisation

## Lifecycle
`NOT_CONNECTED → INITIATING → AWAITING_USER_AUTHORIZATION → AUTHORIZED → SYNC_PENDING → ACTIVE`.
 branches to `PARTIALLY_CONNECTED`, `EXPIRED`, `REVOKED`, `FAILED` or
`REQUIRES_ATTENTION`. Transitions are validated server-side; revocation is always
permitted. Callbacks are verified against a stored state hash with a 10-minute TTL;
replays are recorded and never create duplicate connections or imports.

## Consent
Consent records store provider identity, purpose, data categories, period, duration,
refresh frequency and terms version. Revocation immediately marks the connection
`REVOKED` and fails queued jobs; the sync engine re-checks consent before every
retrieval. Consent history is append-only via `ConsentEvent`.

## Synchronisation
Durable `AccountSyncJob` rows are claimed atomically with 5-minute leases, three
attempts and exponential backoff. Checkpoints store provider cursors so incremental
sync downloads only new records. Imports are idempotent on `(accountId, providerTxRef)`;
provider re-delivery increments a duplicate counter rather than creating a second row.
Failures record provider health snapshots and notify the user only after exhaustion.
