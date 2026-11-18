# Release 11 — Credit Marketplace & Loan Management: Assessment

## Releases 1–10 verified present
HEAD `0859344` contains auth/wallet/Raftline settlement, merchant platform,
subscriptions, rewards, R9 financial intelligence and R10 external-account
aggregation with a provider abstraction, AES-256-GCM encryption, verified callbacks,
consent lifecycle and durable sync worker. Last gate: 73 unit / 100 integration /
16 E2E green.

## Regulatory investigation
Official sources consulted: RBI "Guidelines on Digital Lending" (Sep 2022) and the
Digital Lending Directions (2025; multi-lender RE–LSP arrangements effective
1 Nov 2025). They require, among other things, a Key Fact Statement, cooling-off
provision, direct RE disbursement/repayment, restrictions on Default Loss Guarantee
(capped at 5% of portfolio with a 120-day invocation window) and reporting of
Digital Lending Apps. Lending must be carried out by a Regulated Entity (bank /
RBI-registered NBFC); a Lending Service Provider facilitates the workflow.

Nexus Pay has no evidence of RE/LSP status, lender partnerships, bureau access or
required approvals. Therefore: **no real offers, approvals, disbursements or
repayment collections are claimed or executed.** Only a modular lender-provider
abstraction plus an environment-gated, clearly labelled sandbox is implemented.
All production prerequisites are documented in `docs/provider-onboarding.md`.

## Reuse plan
- Mirror R10 provider registry/adapter pattern for lenders; sandbox provider only.
- Reuse AES-256-GCM helper (`lib/security/crypto.ts`) for applicant PII and docs.
- Reuse R9 aggregation (`getCashFlow`, `getExtendedOverview`) for affordability.
- Reuse notification helper, worker bootstrap, control RBAC and audit conventions.

## Financial rules
1. Nexus Pay is a discovery/workflow platform, never the lender.
2. EMI uses documented integer-paise math with explicit assumptions; provider
   schedules take precedence where available.
3. Submission ≠ approval ≠ disbursement. Only verified provider evidence changes state.
4. No wallet is debited for repayments; no automatic mandates are created.
5. Pre-assessment is never called a credit approval or bureau score.
