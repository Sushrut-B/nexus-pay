# Release 16 — Investments, Portfolio & Wealth: Implementation Report

## 1. Implementation summary

Release 16 adds an integrated Investments section: provider connection and consent lifecycle, durable read-only synchronization, portfolio holdings and valuations with source attribution and staleness, explainable allocation insights, fund/instrument discovery, watchlists with price alerts, a hypothetical SIP calculator and read-only SIP tracker, fixed-income tracking, investment goals, net worth reusing existing account analytics, secure documents, notifications, and Nexus Control Investment Operations. No real provider, holding, NAV, price or return is fabricated; no trading or investment advice is offered.

## 2. Existing modules reused

Existing Raftline wallet read (`buildWalletOverview`/`getAccountAnalytics`), external-account connection and consent patterns, AES-256-GCM encryption and signed document links, durable job claim/lease/backoff/dead-letter, webhook verification, `createNotification`, fraud `publishSecurityEvent`, Control RBAC/audit, API and UI conventions. No new analytics engine: portfolio analytics operate on provider snapshots only and do not enter cash-flow analytics.

## 3. Database models and migrations

Migration `20261120104733_release16_investments_wealth`. 28 new models covering providers/capabilities, connections, consents/events, sync jobs/history, accounts, holdings, transactions, valuations, documents, instruments, price history, mutual funds, watchlists/items, price alerts, investment plans, SIP tracking, goals/contributions, fixed income, net-worth snapshots, portfolio/allocation snapshots, insights and analytics jobs. `NotificationType` and `SecurityEventType` extended. No payment, transaction or consent table duplicated.

## 4. API endpoints

Portfolio: `/api/investments/portfolio`, `/performance`, `/allocation`, `/holdings`, `/transactions`.
Connections: `/api/investments/providers`, `/connections` (+ authorize, sync, sync-status, revoke-consent, delete).
Discovery: `/funds`, `/funds/:id`, `/instruments`, `/instruments/:id`, `/watchlists`, `/alerts`.
Planning: `/sip/calculator`, `/sips`, `/plans`, `/goals`, `/goals/:id/contributions`, `/fixed-income`.
Insights/documents: `/insights`, `/insights/refresh`, `/documents`, signed download.
Wealth: `/api/wealth/net-worth`, `/snapshot`, `/history`, `/assets`, `/liabilities`.
Control: `/api/control/investments/{overview,providers,jobs,history,documents,jobs/:id/retry,providers/:code/pause,run}`.

## 5. Provider integrations and status

Only `sandbox-investments` is configured, gated by `NEXUS_INVESTMENTS_SANDBOX_ENABLED` and clearly labelled. No SEBI RIA/AMFI ARN/Account Aggregator status exists; no mutual fund ordering, trading, brokerage execution or securities settlement is implemented. Regulatory research is documented in `docs/release-16-assessment.md`.

## 6. Categories supported

Mutual funds, equities, ETFs, bonds/fixed income, retirement and other provider-supported products. Availability is provider-driven; unsupported categories show honest unavailable states.

## 7. Search and portfolio workflows

Connections use a consent-first lifecycle; synchronization verifies consent before every provider call, imports holdings/transactions/valuations/SIPs/funds/instruments with unique provider references, and deduplicates on repeat runs. Portfolio views show source attribution, reported timestamps, staleness flags and integer minor units.

## 8. Payment orchestration and reconciliation

No investment payment flow exists. Holdings are external snapshots, never wallet transactions, and never enter `moneyMovements`/cash-flow analytics. No second ledger.

## 9. Cancellation and refund functionality

Not applicable — no investment transactions are executed by Nexus Pay. Provider-reported redemptions/maturities are displayed as informational records with original provider status.

## 10. Net worth and wealth overview
Net worth reuses `getAccountAnalytics(userId, "ALL")` (live Raftline wallet + linked bank balances minus credit-card/loan liabilities) and adds investment and fixed-income snapshots as separate asset lines. Snapshots are persisted with completeness flags; stale and user-reported data are marked.

## 11. Investment goals
Goals with target amount/date, progress, required monthly contribution and manual progress entries. Goal contributions never create wallet debits or investment transactions.

## 12. Portfolio analytics
Explainable, educational insights (allocation, data quality, freshness) generated from real snapshots with evidence and data timestamps. No portfolio health score, no personalized recommendations and no automatic buy/sell guidance.

## 13. Fraud intelligence integration

Connection, sync, holdings-change, goal and watchlist events flow through the existing security-event outbox. No second risk engine; risk decisions never alter balances.

## 14. Nexus Control additions
Investment Operations with provider health, sync jobs/history, document failures and an audited read-only retry/pause workflow (`investments:read/write`). Operators cannot edit holdings, valuations, ownership, consent or Raftline balances.

## 15. Background workers and webhook handlers
`startInvestmentWorker()` in `instrumentation.ts`: sync jobs, consent expiry, price-alert evaluation and daily snapshots, with lease/backoff/dead-letter and correlation IDs. Signed webhooks are supported by the adapter contract.

## 16. Security and privacy safeguards
Consent-gated synchronization, encrypted credentials, masked account identifiers, ownership checks, encrypted private documents with signed links, rate limits, CSRF, RBAC and append-only audit events. No broker passwords, trading PINs, OTPs or depository credentials collected.

## 17. Tests executed and results
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — pass.
- `pnpm test:unit` — 136 passed (8 new investment unit tests).
- `pnpm test:integration` — pass (11 new investment integration tests incl. consent revocation, dedupe and isolation).
- `pnpm test:e2e` — pass against a production build (3 new investment scenarios).

## 18. Environment variables and Windows setup
`NEXUS_INVESTMENTS_SANDBOX_ENABLED` (false), `NEXUS_INVESTMENTS_STALE_HOURS` (48). Windows: `pnpm install`, `pnpm --filter @nexus/database db:generate`, `prisma migrate deploy`, `pnpm dev`.

## 19. Known limitations and unfinished items
Sandbox-only; no real portfolio provider, NAV feed or order execution. Provider documents are not retrieved by the sandbox. No live price feed, fund transactions, actual SIP mandates or robo-advice. Price alerts evaluate sandbox prices only.

## 20. Confirmation
Releases 1–15 were not rewritten. Changes are additive. All existing unit, integration and E2E suites still pass. Release 17 was not started.
