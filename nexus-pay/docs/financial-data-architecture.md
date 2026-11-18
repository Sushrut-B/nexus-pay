# Release 9 — Financial data architecture

Release 9 is a derived intelligence layer. Raftline remains authoritative for
balances and settlement; PostgreSQL stores classifications, snapshots, insights,
forecasts, anomalies, health scores, assistant conversations and reports.

## Source-of-truth policy

Every figure comes from persisted source records: `TransactionRecord`,
`MerchantPayment`, `GroupSettlement`, `CashbackEntitlement`, `Subscription`/
`BillingOccurrence`, `SavingsGoal`/`SavingsContribution`, and `RewardLedgerEntry`
(points only). No dashboard query mutates source records. Derived data is
rebuildable from sources via the finance worker.

## Central definitions

`lib/finance-intelligence/classification-service.ts` and `aggregation-service.ts`
are the only places that decide what counts as inflow, outflow, expense category
or excluded transfer. All dashboards, assistant answers, charts and reports call
these services, so totals cannot diverge.

See `docs/transaction-classification-rules.md` and `docs/cash-flow-calculations.md`.
