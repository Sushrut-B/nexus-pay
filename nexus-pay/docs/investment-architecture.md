# Investment Architecture

## Boundaries

- Raftline is authoritative for wallet money; PostgreSQL never stores a second wallet ledger.
- Investment providers are authoritative for holdings, NAVs, prices, SIP and transaction status. Nexus Pay stores attributed snapshots.
- A wallet debit is never an investment purchase; no trading, order placement or securities settlement exists.

## Data flow

```
User consent → InvestmentConnection (ACTIVE) → durable InvestmentSyncJob
     → read-only adapter calls → holdings/transactions/valuations/SIPs/funds/instruments
     → unique provider references prevent duplicates → Portfolio & insights views
```

Consent is verified before every sync. Revocation sets the connection REVOKED, fails pending jobs and prevents future provider access. A timeout never mutates holdings or implies failure.

## Net worth

`getAccountAnalytics(userId, "ALL")` supplies the live Raftline wallet read, linked bank balances and liabilities. Investment and fixed-income values are added once as separate asset lines. Rewards points, wallet transfers and unverified assets are excluded.

## Analytics boundary

Investment holdings are external snapshots with no wallet `paymentRef` and no spend/inflow semantics. They are deliberately excluded from `loadClassifiedTransactions`/`moneyMovements`/cash-flow analytics to prevent fabricated income or double counting. Portfolio analytics are a separate snapshot-based service.

## Provider status

Only `sandbox-investments` is configured, gated by `NEXUS_INVESTMENTS_SANDBOX_ENABLED`. No regulatory authorisation or real provider is claimed. See `docs/investment-provider-guide.md`.
