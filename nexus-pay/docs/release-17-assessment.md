# Release 17 — Tax Centre: Audit & Implementation Plan

## Phase 0 — Verification

Baseline commit `261b1cd` contains Releases 1–16. Reusable-source inventory: `docs/tax-reuse-inventory.md`.

## Regulatory research (official sources)

Sources reviewed: Income Tax Department e-Filing portal tax slabs for AY 2026-27 and AY 2025-26, and the Income Tax Department's "Threshold Limits under Income Tax Act" document (AY 2026-27, as amended by Finance Act 2026).

Key FY 2025-26 / AY 2026-27 rules used in the versioned rule set:
- **New regime (115BAC(1A))**: ₹0–4L nil; 4–8L 5%; 8–12L 10%; 12–16L 15%; 16–20L 20%; 20–24L 25%; >24L 30%. Standard deduction ₹75,000. Rebate 87A up to ₹60,000 when total income ≤ ₹12,00,000, with marginal relief. Surcharge 10/15/25% at >₹50L/1Cr/2Cr (capped 25% above ₹5Cr). Cess 4%.
- **Old regime**: ₹0–2.5L nil; 2.5–5L 5%; 5–10L 20%; >10L 30%. Standard deduction ₹50,000. Rebate 87A up to ₹12,500 when total income ≤ ₹5,00,000. Surcharge 10/15/25/37%. Cess 4%.

Every rule set carries financial year, assessment year, version, source reference and last-verified date. All tax arithmetic uses integer minor units (paise).

## Boundaries

- Nexus Pay is **not** a chartered accountancy firm, tax practitioner, authorized filing intermediary or government filing platform.
- No Form 16/26AS/AIS/TIS fabrication, no government API access claim, no simulated return submission or fake acknowledgement.
- Tax estimates are explicitly distinguished from professional advice and assessed liability.
- No second transaction aggregation engine: reuse existing financial intelligence/account/investment services for source data with provenance preserved.
- No automatic classification of wallet transfers as income; all inferred classifications are disclosed and user-confirmable.

## Implementation sequence

1. Audit and rule research (this document).
2. Schema/migrations, financial-year config, versioned tax rule sets.
3. Income consolidation and classification review.
4. Tax calculation engine (both regimes, rebate/surcharge/cess), comparison and history.
5. Capital gains, losses, deductions, credits/TDS reconciliation.
6. Documents (encrypted, signed links), extraction awaiting confirmation, reconciliation.
7. Planning scenarios, deadlines/reminders, reports, filing readiness, Tax Assistant, Control.
8. Tests and hardening.
