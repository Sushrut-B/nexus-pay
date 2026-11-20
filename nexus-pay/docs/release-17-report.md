# Release 17 — Tax Centre: Implementation Report

## 1. Implemented feature summary
Added a Tax Centre with financial-year selection, income consolidation from the canonical financial engine, classification review, a versioned Indian tax calculation engine (old and new regimes), regime comparison, capital-gains candidates from investment records, deduction/TDS/TCS tracking, encrypted tax documents with unconfirmed extraction, statement reconciliation, planning scenarios, configurable deadlines, filing readiness, a permission-controlled Tax Assistant and Nexus Control Tax Operations. All outputs are labelled estimates, never assessed tax or filing confirmations.

## 2. Newly created and modified files
New `lib/tax/**` (rules, pure calculation, mapping, service, document, worker, control, bootstrap), `shared-types/src/tax.ts`, `docs/release-17-assessment.md`, `docs/tax-architecture.md`, `docs/tax-rule-sources.md`, this report, an R17 migration and three test files. Modified 20 existing files additively (schema, exports, enums, env, permissions, navigation, worker registration and docs).

## 3. Database migrations
`20261120130715_release17_tax_centre`: 30 models covering versioned rule sets/slabs/deductions/exemptions/sources, financial years, income records, deductions, payments/credits, capital gains, losses, reconciliation, documents/extractions/verification/access logs, calculations/line items, regime comparisons, planning scenarios, sync jobs/history, reminders and audit events. `NotificationType` and `SecurityEventType` extended.

## 4. Tax-rule sources and versions
- `ITD-FY2025-26-v1` (FY 2025-26 / AY 2026-27): Income Tax Department e-Filing slab page for AY 2026-27 and "Threshold Limits under Income Tax Act" (AY 2026-27, Finance Act 2026), both on incometax.gov.in / incometaxindia.gov.in.
- `ITD-FY2024-25-v1` (FY 2024-25 / AY 2025-26): Income Tax Department AY 2025-26 slab page and PIB Budget 2024 standard-deduction announcement.
Each rule set stores source URL, last-verified date and notes; every calculation records the version used.

## 5. Calculation methodology and tested examples
Integer paise and basis-point rates; no floating point. Gross income → standard deduction (₹75,000 new / ₹50,000 old for salaried) → eligible deductions → slab tax + separately taxed special-rate income (20%) → section 87A rebate with marginal relief where applicable → surcharge with marginal relief → 4% health and education cess → verified credits. Tested examples: new regime salary ₹15,00,000 with ₹75,000 standard deduction → taxable ₹14,25,000, tax ₹97,500; ₹12,75,000 salary → rebate ₹60,000 and nil tax; old regime ₹15,00,000 with ₹1,50,000 deductions → taxable ₹13,00,000, tax ₹2,10,600.

## 6. API documentation
`/api/tax/{dashboard,financial-years,consolidate,income,calculate,compare-regimes,calculations,capital-gains,deductions,credits,payments,documents,reconciliation,scenarios,deadlines,filing-readiness,assistant,profile}` plus signed document download, extraction confirmation and reconciliation resolution; Control `/api/control/tax/{overview,rules,jobs,reconciliation,audit,retry,pause,publish,run}`.

## 7. Provider integrations and limitations
No government income-tax API or filing provider is integrated. Tax documents are user-uploaded; no Form 26AS/AIS/TIS data is fetched from authorities. Credit and tax-credit integrations are read-only user-declared or document-based.

## 8. Environment variables
`NEXUS_TAX_ENABLED` (true), `NEXUS_TAX_DEFAULT_FINANCIAL_YEAR` (2025-26). No tax credentials or PAN values are required; PAN, if provided, is encrypted and masked.

## 9. Windows-compatible setup
`pnpm install`; `pnpm --filter @nexus/database db:generate`; `pnpm --filter @nexus/database exec prisma migrate deploy`; `pnpm dev`. Ensure PostgreSQL on `localhost:5433` and Raftline on `8001–8005`.

## 10. Worker startup
`startTaxWorker()` is registered in `instrumentation.ts` and starts automatically in the Node runtime. It seeds rule sets/deadlines, processes durable jobs with claim/lease/backoff/dead-letter and sends deadline reminders. No browser timers are used.

## 11. Test commands and results
`pnpm typecheck`, `pnpm lint`, `pnpm build`; `pnpm test:unit` (151 passed, 15 new); `pnpm test:integration` (12 new tax tests passed); `pnpm test:e2e` (3 new tax scenarios passed). Live page checks for `/tax`, `/tax/compare`, `/control/tax` returned 200.

## 12. Security and privacy implementation
Strict ownership checks, encrypted documents with signed 5-minute links, access logs, sensitive PAN encryption/masking, rate limits, CSRF, RBAC (`tax:read/write`), audit events and no external AI calls for document content. Extracted values require user confirmation before use.

## 13. Known limitations and incomplete dependencies
No OCR engine is installed; extraction records only clearly labelled unconfirmed metadata fields. No actual filing, acknowledgement, government data access or assessed liability. Surcharge/special-rate handling is configurable and simplified with disclosed assumptions; marginal relief is approximated for slab thresholds. Capital gains require verified cost basis and holding period before classification.

## 14. Confirmation of regression testing
Releases 1–16 were not rewritten — changes are additive. All existing unit, integration and E2E suites pass. Release 18 was not started.
