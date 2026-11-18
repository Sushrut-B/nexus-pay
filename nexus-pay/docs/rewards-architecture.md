# Release 8 — Rewards architecture overview

## Separation of value types

| Concept | Storage | Authoritative? | INR value |
| --- | --- | --- | --- |
| Wallet balance | Raftline account | Yes (Raftline) | Yes |
| Reward points | `reward_ledger_entries` + `reward_accounts` | Nexus Pay ledger | None (non-cash) |
| Cashback entitlement | `cashback_entitlements` | Nexus Pay state + Raftline receipt | Sandbox wallet credit |
| Promo discount | `campaign_budget_reservations`, `promo_code_redemptions` | Nexus Pay metadata | Reduces payable amount |

Points are never wallet money, have no INR conversion, and cannot be withdrawn.

## Money movement

Every cashback credit uses `getOrCreateFundingOperation` + `executeFundingOperation`,
which calls Raftline's simulated `fundAccount` with a stable idempotency key and only
marks `COMPLETED` after a verified receipt. A timeout keeps the entitlement in
`REQUIRES_RECONCILIATION`; the same key is reused. No manual "credited" flag exists.

## Ledger

`reward_ledger_entries` is append-only. Every points change creates an immutable,
idempotency-keyed entry with a resulting balance. Corrections are compensating entries.
The conditional balance decrement prevents negatives even under concurrency.

See `docs/points-ledger.md`, `docs/cashback-processing.md` and `docs/campaign-guide.md`.
