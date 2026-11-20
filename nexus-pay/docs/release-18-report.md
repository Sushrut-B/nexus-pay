# Release 18 — Global Finance — Delivery Report

## 1. Implementation summary

Release 18 adds a **separate Global Finance domain module** to Nexus Pay for
multi-currency tracking, valuation, FX rate infrastructure, provider-ready FX
quotes, international payment architecture, compliance-ready states, and Nexus
Control operations. It deliberately **does not** create a second transaction
engine, second ledger, second wallet, or FX settlement path.

INR remains the only transactable Nexus Pay wallet currency and Raftline remains
authoritative for all committed wallet settlement. Other currencies are used for
labelled tracking, valuation, planning and provider-sandbox fixtures only.

Release 19 was **not** started.

## 2. Files created and modified

### New domain module (`apps/web/lib/global/`)
- `currency-service.ts` — currency catalogue, exact decimal-ratio helpers,
  explicit ISO-4217 precision, inverse-rate helper.
- `fx-adapter.ts`, `fx-quote-service.ts`, `fx-service.ts` — provider contract,
  persisted rate engine (latest/historical/conversion), quote lifecycle.
- `global-audit.ts` — audit/notifications/security-event helpers.
- `global-accounts-service.ts` — multi-currency accounts, balance snapshots,
  foreign assets/liabilities (reuses `listAccounts`).
- `global-expenses-service.ts` — foreign expenses, travel currency, explainable
  insights (reuses `loadClassifiedTransactions`, travel/wealth/subscription).
- `watchlist-service.ts` — watchlists, alerts, deduped alert evaluation.
- `international-adapter.ts`, `international-payment-service.ts` — provider
  contract, beneficiaries, corridors, transfer state machine, webhook HMAC,
  reconciliation, compliance checks.
- `providers/index.ts`, `providers/sandbox-fx.ts`,
  `providers/international-index.ts`, `providers/sandbox-international.ts` —
  env-gated registries with `UNAVAILABLE` + 503 states and notices.
- `global-dashboard-service.ts`, `global-worker-bootstrap.ts`.

### Shared packages
- `packages/shared-types/src/global.ts` (new), `money.ts` (precision helpers),
  `index.ts` (barrel), `social.ts` + `security.ts` (new event types).
- `packages/validation/src/index.ts` — Release 18 validation block.
- `apps/web/lib/env.ts`, root `.env.example` — R18 configuration flags.

### App / UI
- `apps/web/instrumentation.ts` — registers `startGlobalWorker()`.
- `apps/web/lib/control/auth.ts` — `global:read` / `global:write` permissions.
- `apps/web/components/control/control-shell.tsx` — `/control/global` nav item.
- `apps/web/components/layout/customer-nav.tsx` — Global Finance nav item.
- `apps/web/components/global/global-ui.tsx` (new).
- 15 customer pages under `app/(customer)/global-finance/**` plus
  `app/control/global/page.tsx`.
- ~35 API routes under `app/api/global-finance/**`,
  `app/api/international-payments/**`, `app/api/control/global/**`.

### Database / docs / tests
- `packages/database/prisma/schema.prisma` — 25 new models + enum values.
- `packages/database/prisma/migrations/20261120140000_release18_global_finance/migration.sql`.
- `docs/release-18-assessment.md`, `docs/release-18-report.md`.
- `tests/unit/global-currency.test.ts`,
  `tests/integration/release18-global.test.ts`,
  `tests/e2e/release18-global.spec.ts`.

## 3. Database migrations

Single additive migration `20261120140000_release18_global_finance` (applied
successfully with `prisma migrate deploy`):

- Extends `NotificationType` and `SecurityEventType` enum values.
- Creates `global_user_preferences`, `fx_providers`, `fx_rates`, `fx_sync_jobs`,
  `currency_watchlists`, `rate_alerts`, `global_accounts`,
  `global_balance_snapshots`, `foreign_assets_liabilities`, `fx_quotes`,
  `international_providers`, `corridor_configurations`,
  `international_beneficiaries`, `international_transfers`,
  `international_transfer_events`, `international_payment_webhooks`,
  `international_reconciliations`, `international_compliance_checks`,
  `foreign_expenses`, `travel_cash_records`, `global_insights`,
  `global_audit_events`.

No existing table, column or enum value was removed or altered incompatibly.
No wallet, ledger, payment-intent or Raftline table was modified. Amounts use
`BigInt` minor units; timestamps are UTC; source references and user ownership
are stored on every record.

## 4. Supported currencies

Display/valuation catalogue comes from the configured currency service:
**INR, USD, EUR, GBP, SGD, AED, AUD, CAD, JPY, CHF** (plus KWD/BHD/OMR/TND in
the exponent table for future provider support). INR is flagged as the only
`transactableWallet` currency. Selecting a display currency never changes the
wallet currency.

## 5. Exchange-rate provider details

- `sandbox-fx` — deterministic **test fixtures**, OFF by default
  (`NEXUS_GLOBAL_FX_SANDBOX_ENABLED=false`). Provides latest, historical and
  currency discovery; **no executable quotes**. Rates are classified
  `REFERENCE` (latest) or `HISTORICAL`, with source reference, `asOf`,
  precision and a prominent notice. Production adapters require a licensed
  data provider, attribution, credentials and legal review. No provider names,
  credentials or live rates are fabricated.
- Provider rows and capabilities are upserted for Control visibility; disabled
  providers return `UNAVAILABLE` and `503`.

## 6. Rate classification and precision methodology

- Classifications are strictly `INDICATIVE | REFERENCE | PROVIDER_QUOTE |
  EXECUTABLE_QUOTE | HISTORICAL` and are never interchanged. Sandbox data can
  never be an executable quote.
- Rates are exact decimal strings parsed to bigint numerator/denominator;
  `convertMinor` performs bigint cross-multiplication and explicit rounding
  (`HALF_UP` default; `HALF_EVEN`, `FLOOR`, `CEIL` supported). No float is used
  for money.
- ISO-4217 exponents are explicit: JPY = 0; KWD/BHD/OMR/TND = 3; others = 2.
- Every conversion carries original amount/currency, rate, classification,
  provider, timestamp, rounding method, and a fees-not-included notice.
- Stale rates are flagged and suppressed from display conversions; they are
  never substituted for a current quote.

## 7. Raftline compatibility findings

Direct source audit (see `docs/release-18-assessment.md`):

- No `Currency` enum, allow-list or validation; currency is a raw string
  (default `"USD"`), any 3-letter code accepted. Demo data: USD, EUR, INR.
- Amounts are `long` minor units; balances are mutable scalars in Raft KV,
  not a second ledger.
- Settlement rails: `FEDNOW`, `SEPA_INSTANT`, `UPI`, `FASTER_PAYMENTS`,
  `INTERNAL_BOOK`; `SYSTEM_RESERVE` is a synthetic source, not a rail.
- Cross-currency settlement is rejected with `CURRENCY_MISMATCH`
  (`PaymentSettlementEngine.java:264-267`). No FX/conversion code exists.
- Idempotency is SHA-256 over `SETTLE|rail|source|dest|amountCents|currency`
  with guarded KV writes and cached receipt replay.
- No refund, reversal or chargeback; `voidHold` only releases unspent holds.
- Nexus Pay app layer hard-locks wallet funding/payments to INR.

**Verdict:** Release 18 keeps INR as the only transactable wallet currency;
all other currency activity is tracking/valuation only and never touches
Raftline settlement.

## 8. International payment provider status

**UNAVAILABLE for execution.** `sandbox-intl` is a sandbox provider with
`transfers=false`, `quotes=false`, `refunds=false`, `status=false`. Even when
its env flag is enabled it cannot submit, confirm or refund a transfer.
Transfers created through the UI are clearly labelled previews; no wallet is
debited, no recipient is credited, and no provider is contacted. Unknown
outcomes are reconciled only from an original provider reference, never by
blind retry or a new idempotency key.

## 9. Regulatory and compliance limitations

Based on official RBI/FEMA sources:

- LRS Master Direction: resident individuals may remit up to **USD 250,000 per
  financial year** through Authorised Dealers with PAN/Form A2/KYC/AML.
- MTSS is **inward-only** and requires an RBI-authorized Indian Agent; it is
  not an outward remittance product.
- RBI circular dated 13 May 2026 permits non-bank facilitation of outward
  remittance only through AD Category-I banks with strict responsibility,
  disclosure, invoice, grievance, privacy and fund-flow conditions.

Nexus Pay holds none of these authorisations. Compliance states
(`NOT_REQUIRED … EXPIRED`) are recorded only from actual provider/authorized
results. No sanctions screening, KYC approval or regulatory compliance is
claimed from technical controls.

## 10. API documentation

All endpoints require authentication and user ownership checks; mutations
require CSRF and are rate-limited; errors use the shared `ApiError` envelope.

Global finance (`/api/global-finance/`):
`GET dashboard`, `GET/PUT preferences`, `GET currencies`, `GET rates`,
`GET rates/history`, `POST convert`, `GET providers`,
`GET/POST accounts`, `DELETE accounts/:id`,
`GET/POST watchlists`, `PATCH/DELETE watchlists/:id`,
`GET/POST alerts`, `PATCH/DELETE alerts/:id`,
`GET/POST fx/quotes`, `GET fx/quotes/:id`, `POST fx/quotes/:id/confirm`,
`GET/POST expenses`, `GET expenses/summary`, `GET expenses/by-currency`,
`GET/POST assets`, `DELETE assets/:id`, `GET travel`, `POST travel/cash`,
`GET insights`.

International payments (`/api/international-payments/`):
`GET providers`, `GET corridors`, `GET/POST beneficiaries`,
`GET beneficiaries/:id`, `POST quotes`,
`GET/POST transfers`, `GET transfers/:id`, `POST webhooks` (HMAC verified,
de-duplicated).

Control (`/api/control/global/`): `GET` overview,
`POST providers/:code` (pause/resume), `POST jobs/:id/retry` (read-only jobs
only), `POST reconcile` (requires provider reference; no outcome invented).

## 11. Environment variables and secrets

- `NEXUS_GLOBAL_ENABLED` (default `true`)
- `NEXUS_GLOBAL_FX_SANDBOX_ENABLED` (default `false`)
- `NEXUS_GLOBAL_PAYMENTS_SANDBOX_ENABLED` (default `false`)
- `NEXUS_GLOBAL_RATE_STALE_HOURS` (default `24`)
- `NEXUS_GLOBAL_DEFAULT_DISPLAY_CURRENCY` (default `INR`)
- `AUTH_SECRET` — reused with a domain-separated HMAC key for international
  webhook signature verification. No bank credentials, UPI PINs or card PINs
  are collected. Beneficiary details are AES-256-GCM encrypted via
  `encryptSecret`; only masked identifiers are returned.

## 12. Windows setup instructions

```powershell
cd C:\Sushrut\projects\nexus-pay
pnpm install
pnpm --filter @nexus/database db:generate
pnpm --filter @nexus/database exec prisma migrate deploy
$env:NODE_OPTIONS="--max-old-space-size=6144"
pnpm dev
```

For a production build: `$env:NODE_OPTIONS="--max-old-space-size=6144"; pnpm build`
then `pnpm --filter @nexus/web start`.

## 13. Worker startup

`startGlobalWorker()` is registered in `apps/web/instrumentation.ts` alongside
the existing workers. It runs every 60 seconds with durable `FxSyncJob`
persistence, atomic claim, 5-minute lease, exponential backoff, 3-attempt
dead-lettering, lease recovery after restart, and audit/security events.
Only read-only job kinds are accepted (`RATE_SYNC`, `HISTORICAL_RATE_SYNC`,
`VALUATION_SNAPSHOT`, `ALERT_EVALUATION`, `FX_QUOTE_EXPIRY`,
`WEBHOOK_PROCESSING`). Transfer submission/status jobs cannot be enqueued.

## 14. Test commands and results

```powershell
pnpm typecheck                         # passed (6/6 packages)
pnpm lint                              # passed (no warnings/errors)
pnpm test:unit                         # 20 files, 162 tests passed
pnpm test:integration                  # 21 files, 193 tests passed
$env:NODE_OPTIONS="--max-old-space-size=6144"; pnpm build   # compiled, 191 pages
pnpm test:e2e                          # 38 files/tests passed (35 regression + 3 new)
```

Integration: 21 files / 193 tests passed (14 gated skips). During the first full
run, three unrelated suites (release5-control, release6-merchant and release11-credit)
failed because the Raftline cluster briefly had no elected leader while the
production build, integration suite and browser suite ran concurrently. All three
passed cleanly on rerun (24/24 tests) with no code changes; the R18 suite itself
passed 16/16 on both runs.

E2E: 38/38 passed, including all 3 new Release 18 specs.

Coverage includes: INR→USD, USD→INR, EUR→INR, JPY zero-decimal, KWD
three-decimal, invalid codes, missing/stale rates, rounding, large amounts,
reference-rate classification, quote expiry/confirmation, provider failure,
beneficiary encryption, webhook signature/de-duplication, idempotency,
cross-user IDOR prevention, canonical-path reuse (no double counting), and
worker claim/completion.

## 15. Security implementation summary

- Authentication on every endpoint; per-user ownership checks on every record.
- User-level authorization plus Control `global:read`/`global:write` roles.
- CSRF on mutations, rate limiting, input validation, `ApiError` redaction.
- AES-256-GCM encryption of beneficiary details and account references;
  masked display; no full identifiers in API responses.
- HMAC-SHA256 webhook verification with constant-time comparison and event-id
  de-duplication.
- Audit events for privileged and financial-state changes; security outbox via
  `publishSecurityEvent`; notifications via the existing engine.
- No silent conversion, no manual rate overrides, no balance edits, no transfer
  completion without provider confirmation, and no duplicate retry keys.

## 16. Incomplete features and dependencies

Intentionally unavailable until real, verified integrations exist:

1. **Executable FX conversion / FX execution** — requires a licensed FX
   counterparty and executable-quote capability.
2. **Real international transfers / remittances** — requires an RBI-authorised
   arrangement through AD Category-I banks (or equivalent jurisdiction licence),
   provider corridors, KYC/AML and sanctions screening from that provider.
3. **Live market exchange rates** — requires a licensed data provider with
   attribution and usage rights; only labelled sandbox fixtures are supplied.
4. **Real provider identity/beneficiary verification** — mandated by the
   authorized provider, not synthesized by Nexus Pay.
5. **Foreign-currency wallet balances and cross-currency settlement** —
   Raftline has no FX or cross-currency settlement; not claimed or implemented.
6. **FX cash delivery / international card spending** — no verified provider.

## 17. Regression results

- Releases 1–17 remain present and unchanged in behaviour; typecheck, lint,
  unit and full integration suites pass with the new module added.
- Raftline settlement, wallet funding, idempotency and receipt verification
  tests pass unchanged (`verify.test.ts`, integration payment suites).
- Existing accounts, finance intelligence, travel, investments/wealth, tax,
  notifications and Nexus Control suites pass unchanged.
- Global Finance reuses `loadClassifiedTransactions`, `listAccounts`,
  `getNetWorth`, travel and subscription services and asserts no double
  counting; the INR-only wallet invariant is explicitly asserted.
