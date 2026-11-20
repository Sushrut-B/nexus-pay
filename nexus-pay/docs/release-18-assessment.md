# Release 18 — Assessment, Audit Findings & Implementation Plan

This document records the mandatory pre-implementation audit for Release 18 (Global
Finance). It is based on direct inspection of the Nexus Pay source and the Raftline
Java core, plus official RBI/FEMA sources. Release 18 was **not** started in any
prior release; `docs/release-17-report.md` confirms it.

## 1. Release 1–17 baseline (verified)

- `apps/web/lib` service directories present: accounts, api, auth, billing, control,
  credit, finance, finance-intelligence, fraud, insurance, investments, merchant,
  payments, rewards, security, social, subscription, tax, travel, wallet.
- 32 Prisma migrations (`init` + releases 2–17). Latest:
  `20261120130715_release17_tax_centre`.
- R17 artifacts present (`tax-service`, `shared-types/tax.ts`, validation block,
  env flags, report, integration + E2E tests).
- Baseline gates at start of R18: `pnpm typecheck` ✅, `pnpm lint` ✅,
  `pnpm test:unit` ✅ (151 passed).

Verdict: Releases 1–17 are genuinely implemented. No work from this prompt was
assumed; the audit read source and migration files.

## 2. Raftline currency capability audit (definitive)

Inspected all 119 Java source files, resources, Helm/Docker config, and the
`api-client` package.

| Layer | Actual currency support |
|---|---|
| Raftline Java engine | **No `Currency` enum, no allow-list, no validation.** Currency is a raw `String`, default `"USD"`. Any 3-letter string is accepted. Demo/seed data uses USD, EUR, INR. |
| `api-client` | `z.string().min(3).max(3)` — length only; default `"INR"`. |
| Nexus Pay application flows | **INR only** — `z.literal("INR")`, `currency: "INR"` in payment/funding services, wallet funding guard. |

Key evidence:

- `PaymentAccount.java:19` `private String currency;` default `"USD"` at `:34`.
- `PaymentRail.java:6-11`: `FEDNOW, SEPA_INSTANT, UPI, FASTER_PAYMENTS, INTERNAL_BOOK`.
  `SYSTEM_RESERVE` is a synthetic source account, **not** a rail.
- `PaymentSettlementEngine.java:264-267` rejects cross-currency settlement with
  `CURRENCY_MISMATCH`. **Only same-currency transfers settle.**
- No FX/conversion code anywhere (only Raft-consensus / protobuf "convert").
- Amounts are `long` minor units; balances are mutable scalars in Raft KV, not a
  double-entry ledger table. `PaymentResult` stores `sourceBalanceAfter` /
  `destinationBalanceAfter`.
- Idempotency: SHA-256 fingerprint over `SETTLE|rail|source|dest|amountCents|currency`;
  guarded `MULTI_PUT`; keys `pay:idemfp:*`, `pay:idem:*`, `pay:tx:*`, `pay:ref:*`;
  identical replay returns cached receipt with `isIdempotentReplay=true`; different
  payload with same key → 409 conflict.
- **No refund, reversal or chargeback.** `voidHold` only releases an unspent
  authorization. (See `docs/merchant-refunds.md`.)
- No currency config in `RaftConfig`, `Tenant`, deployment values, or client config.

### Verdict

Raftline can settle **same-currency** transfers for arbitrary currency labels, but
has **no FX, no cross-currency settlement, and no reversal**. Nexus Pay deliberately
hard-locks real wallet funding/settlement to INR.

### Release 18 boundary (consequences)

**MUST NOT:** claim multi-currency wallet balances; perform FX execution; present
indicative rates as executable quotes; settle cross-currency; bypass Raftline; add a
second ledger; refund settled payments; fabricate providers.

**MAY:** track/label other currencies for valuation, planning and reporting;
show provider-sandbox fixtures clearly labelled; build provider-ready quote and
transfer state machines that remain `UNAVAILABLE` until a verified authorized
provider is integrated; keep INR as the only transactable wallet currency.

## 3. Regulatory research (official sources)

- **RBI LRS Master Direction** (FED Master Direction No. 7/2015-16, updated
  06 Sep 2024): resident individuals may remit up to **USD 250,000 per financial
  year** through Authorised Dealers (ADs) for permitted current/capital account
  transactions; not available to corporates/HUF/trusts; PAN, Form A2, KYC/AML
  required; TCS provisions apply.
- **RBI/FEMA MTSS Master Direction**: Money Transfer Service Scheme is
  **inward-only** to India and must operate through an RBI-authorized Indian Agent
  and overseas correspondent — it is not an outward remittance product.
- **RBI circular 13 May 2026**: non-banks may facilitate outward remittance only
  through AD Category-I banks, with the AD bearing KYC/AML and transaction
  responsibility; strict disclosure, invoice, grievance-redressal, data-privacy
  and fund-flow conditions apply.

**Compliance posture:** Nexus Pay has none of these authorisations. Release 18
implements *compliance-ready states* fed only by actual provider/authorized results
(`NOT_REQUIRED ... EXPIRED`). It never claims screening/KYC approval, never claims
remittance authorization, and gates all provider capabilities off by default.

## 4. Reuse inventory (no second engine)

Release 18 reuses the canonical consolidation and domain services:

- `finance-intelligence/classification-service.ts` → `loadClassifiedTransactions`,
  `moneyMovements` (single canonical data path; de-duplicates imports).
- `accounts/accounts-service.ts` → `listAccounts`, `getAccountAnalytics`;
  `ExternalAccountView` carries per-account `currency`, `balanceMinor`.
- `investments/portfolio-service.ts` → `getPortfolio`, `listInvestmentTransactions`;
  `wealth-service.ts` → `getNetWorth`, `listFixedIncome` (holdings carry `currency`).
- `travel/trip-service.ts` → `listTrips`, `getItinerary`, `listExpenses`.
- `tax/tax-service.ts` → `getDashboard`, `getCapitalGains`;
  `tax-mapping-service.ts` `consolidateIncome` preserves `(amountMinor, currency)` —
  the exact original-amount pattern R18 mirrors.
- `subscription/...` + `billing/catalog-service.ts` `BILL_CATEGORY_LABELS`.

Provider/worker/document/control patterns to mirror:

- `accounts/providers/index.ts` + `investments/providers/index.ts` → env-gated
  registry, `UNAVAILABLE` + 503, `ensureRecords`, capabilities, notices.
- `investments/sync-service.ts` + `travel/travel-webhook-service.ts` → atomic claim,
  lease, backoff, dead-letter. Register in `instrumentation.ts`.
- `security/crypto.ts` → `encryptSecret`/`decryptSecret`/`secretHint` for beneficiary
  PII; HMAC signed links from `travel/document-service.ts`.
- `social/shared.ts` `createNotification`; `fraud/event-service.ts`
  `publishSecurityEvent`; `control/auth.ts` `PERMISSIONS`; `control-shell.tsx` NAV.

## 5. Currency representation decision

- Extend `money.ts` with an explicit ISO-4217 minor-unit exponent table (JPY = 0,
  most = 2, BHD/KWD/OMR/TND = 3) and precise `parseMajorToMinorByCurrency`,
  `formatMinorCurrencyByCurrency`, and BigInt-based conversion helpers. No floats.
- Every R18 record stores **original `(amountMinor, currency)`** verbatim. Conversion
  is a pure, separately invoked layer:
  `(amountMinor, source, target, rate, sourceRef, asOf) → convertedMinor` with
  explicit rounding. Nothing mutates an original.
- Rates classified strictly as `INDICATIVE | REFERENCE | PROVIDER_QUOTE |
  EXECUTABLE_QUOTE | HISTORICAL`. Reference/indicative values are never presented
  as executable. Executable conversion remains unavailable without a verified
  provider.

## 6. Supported display currencies (from currency service/provider capability)

INR, USD, EUR, GBP, SGD, AED, AUD, CAD, JPY, CHF. Wallet settlement: INR only.
The list is configuration, not a claim of wallet support.

## 7. Implementation phases (this release)

1. Assessment (this doc) + baseline gates — **done**
2. Currency foundation: precision helpers, shared types, schema, sandbox FX provider,
   rate sync + history.
3. Currency management: converter, multi-currency accounts, watchlists, alerts.
4. Expense/wealth integration: foreign expenses, travel cash, foreign assets/
   liabilities, net-worth integration, insights.
5. FX quotes: state machine, confirmation, no-execution notice.
6. International payments: provider abstraction (UNAVAILABLE), beneficiaries,
   corridors, compliance, transfer lifecycle, webhooks, reconciliation.
7. Nexus Control: provider health, rate freshness, jobs, reconciliation, audit.
8. Tests + hardening + full gates.

Release 19 is explicitly out of scope and is not started.
