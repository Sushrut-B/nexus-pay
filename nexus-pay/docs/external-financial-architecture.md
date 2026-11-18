# Release 10 — Unified financial hub architecture

Nexus Pay remains the authoritative ledger for wallet money (Raftline). Release 10
adds a read-only aggregation layer for supported external financial accounts.

```
Customer UI → /api/accounts/** → connection/consent/sync services
                                      ↓
                          provider adapter registry
                          ├── sandbox (test only, env-gated)
                          └── production adapters (not configured)
                                      ↓
                   ExternalAccount / BalanceSnapshot / ExternalTransaction
                                      ↓
                   R9 classification funnel (opt-in) → analytics
```

External transactions are never executed by Nexus Pay and never move wallet money.
External balances are provider-reported, read-only values; credit card and loan
amounts are liabilities and are never added to cash balances.

No Account Aggregator approval, production bank connectivity or regulatory
certification is claimed. See `docs/provider-setup.md` for prerequisites.
