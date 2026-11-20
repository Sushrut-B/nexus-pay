# Investment Provider Adapter & Onboarding Guide

## Regulatory context

Official sources reviewed: SEBI (Investment Advisers) Regulations 2013 (amended Aug 2025) and SEBI IA FAQs, AMFI Master Circular for Mutual Fund Distributors (Jan 2026), AMFI ARN/EUIN guidance, and the RBI Account Aggregator framework context.

- Investment advice for consideration requires SEBI RIA registration; MF distributors may give only incidental advice for schemes they distribute and cannot offer holistic financial planning or use "wealth adviser" nomenclature without RIA registration.
- Mutual fund distribution requires NISM V-A, AMFI ARN and AMC empanelment.
- Account Aggregator / Financial Information User roles require separate RBI-authorised status.

Nexus Pay has none of these authorisations. The module is informational, read-only and educational; it never executes trades or gives personalized recommendations.

## Adapter interface

`InvestmentAdapter` (`apps/web/lib/investments/investment-adapter.ts`) declares capabilities and methods: `getProviderDetails`, `getCapabilities`, `discoverAccounts`, `getHoldings`, `getTransactions`, `getValuation`, `listFunds`, `getFund`, `searchInstruments`, `getPrice`, `listSips`, `verifyWebhook`. Unsupported operations must be declared false. All money is integer minor units.

## Onboarding

1. Implement the adapter in `lib/investments/providers/`.
2. Register it in the registry and env gate.
3. Store credentials in secret management; never collect broker passwords, trading PINs, OTPs or depository credentials.
4. Obtain explicit consent with data categories and expiry for every connection.
5. Complete commercial, technical and regulatory prerequisites before enabling production.

## Synchronization

Durable `InvestmentSyncJob` rows with atomic claim, lease, retry with backoff and dead-letter. Consent verified before every eligible sync; unique provider references prevent duplicate accounts, holdings and transactions. Partial sync recovery is supported through re-enqueueable read-only jobs.

## Status

| Capability | Status |
| --- | --- |
| Adapter, connection/consent, sync, portfolio, discovery, watchlists, SIP planner, goals, net worth, Control | Implemented |
| Sandbox provider (`sandbox-investments`) | Sandbox only (`NEXUS_INVESTMENTS_SANDBOX_ENABLED=true`) |
| Real investment/AA provider, live prices, provider documents, SIP mandates, trading | Not connected / not supported |
