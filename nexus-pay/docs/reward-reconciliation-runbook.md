# Reward reconciliation & worker recovery runbook

## Reconciliation view
`GET /api/control/rewards/reconciliation` compares:
- points ledger sum vs account balances,
- reserved vs consumed campaign budget,
- outstanding cashback entitlements,
- open budget reservations,
- qualified referrals without issued rewards.

Discrepancies are flagged, never silently repaired.

## Worker recovery
One unified rewards worker (`lib/rewards/rewards-worker.ts`) runs from
`instrumentation.ts` every 30s. It performs points expiry, campaign activation and
expiry, exhaustion checks, reservation cleanup, reward earning, cashback processing,
referral qualification and tier evaluation.

- Atomic claims and 5-minute leases prevent concurrent execution.
- Crashes leave records in a retryable state; leases expire and work is reclaimed.
- Cashback uses the same funding-operation idempotency key across restarts.
- Operator trigger: `POST /api/control/rewards/run` (rate limited, audited).

## Manual adjustment
`POST /api/control/rewards/adjustments` requires `rewards:write`, a reason and an
idempotency key; limit 5,000 points, >1,000 requires SUPER_ADMIN. Adjustments never
touch wallet funds and are always audited and notified.
