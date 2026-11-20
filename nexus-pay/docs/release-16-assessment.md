# Release 16 — Investments, Portfolio & Wealth: Audit & Implementation Plan

## Phase 0 — Verification

Baseline commit `de01442` contains Releases 1–15. Reusable-component inventory: `docs/investments-reuse-inventory.md`.

## Regulatory research (official sources)

Sources reviewed: SEBI (Investment Advisers) Regulations 2013 (as amended Aug 2025) and SEBI IA FAQs (Aug 2025), AMFI Master Circular for Mutual Fund Distributors (Jan 2026) and AMFI ARN/EUIN guidance, plus RBI Account Aggregator framework context.

- Providing investment advice for consideration requires **SEBI RIA registration**. AMFI-registered distributors may give only *incidental* advice about schemes they distribute; they may not offer holistic financial planning or use "Wealth Adviser"/"Independent Financial Adviser" nomenclature without RIA registration.
- Mutual fund distribution requires NISM V-A certification, AMFI ARN and empanelment with each AMC.
- An Account Aggregator / Financial Information User role requires separate RBI-authorised status and provider arrangements.

Nexus Pay has **none** of these authorisations. Therefore:
- No personalized buy/sell recommendations, no "wealth adviser" branding, no portfolio health score presented as advice.
- No mutual fund ordering, SIP mandates, trading, brokerage execution or securities settlement.
- Insights are educational, explainable and sourced; historical returns carry a "past performance does not guarantee future results" disclosure.
- The only provider is an env-gated, visibly labelled **sandbox**; no real holdings, prices or valuations are invented.

## Non-negotiable architecture rules

1. Preserve Releases 1–15; additive changes only.
2. No duplicate analytics/consent/notification/scheduling engines — reuse existing ones.
3. Raftline remains authoritative for wallet money; no second ledger.
4. Investment holdings are **external snapshots**, not wallet transactions; they must not enter transaction analytics as spend.
5. Net worth reuses existing Raftline wallet balance, external bank balances and loan liabilities; no double counting.

## Implementation sequence

1. Provider contracts + registry + sandbox + connection/consent lifecycle.
2. Schema/migrations and durable sync engine.
3. Portfolio holdings, valuations, transactions, snapshots, explainable analytics.
4. Fund/instrument discovery, watchlists, price alerts (data-only).
5. SIP calculator (hypothetical) and tracker, fixed-income, goals, net worth.
6. Secure documents, notifications, Control Investment Operations.
7. Tests and documentation.
