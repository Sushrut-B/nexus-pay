# Tax Architecture

## Boundaries

- Nexus Pay is not a chartered accountancy firm, tax practitioner, filing intermediary or government platform.
- Tax figures are estimates from user records and versioned rules, never assessed tax liability.
- No second transaction aggregation engine exists: tax reads the canonical `loadClassifiedTransactions` + `moneyMovements` once and derives candidate records from provenance.

## Data flow

```
Canonical finance engine (loadClassifiedTransactions + moneyMovements)
        → TaxIncomeRecord candidates (sourceType, sourceRef, assumptions)
        → user review / confirmation
        → versioned TaxRuleSet (slabs, rebate, surcharge, cess)
        → TaxCalculation (old + new), line items, comparison
        → reports, filing readiness, assistant (all read-only)
```

No wallet transfer is automatically income. Rewards, internal transfers, refunds and group settlements keep the engine's exclusions.

## Net worth and liabilities
Reuses `getAccountAnalytics(userId, "ALL")` and `getNetWorth`; tax does not re-sum wallets or accounts.

## Documents and reconciliation
Tax documents are encrypted at rest with signed short-lived download links. Extraction output is always unconfirmed until the user verifies it. Statement reconciliation preserves original payloads and never auto-removes duplicates.

## Regulatory data
Rule sets carry official source references, last-verified dates and version numbers. Deadlines are configurable with source references and preserved history. No filing status or acknowledgement is fabricated.
