# Release 12 — Insurance Marketplace & Policy Management: Implementation Report

## 1. Summary

Release 12 adds a provider-ready Insurance Marketplace and Policy Management module to Nexus Pay. Users can browse provider-backed products, compare them within a category, request quotes, submit applications, view provider-confirmed policies, track premiums and renewals, follow claims, and manage consent — all inside the existing Nexus Pay application.

Nexus Pay is **not** an insurer, broker, corporate agent, web aggregator or licensed intermediary. No real insurer, quote, policy, claim, approval or document is fabricated. The only configured integration is an environment-gated, clearly labelled **sandbox demonstration insurer** (`sandbox-insurer`). All production prerequisites are documented in [insurance-provider-onboarding.md](insurance-provider-onboarding.md).

## 2. Existing modules reused

- Provider abstraction pattern from Releases 10/11 (`lib/accounts/provider-adapter.ts`, `lib/credit/lender-adapter.ts`).
- AES-256-GCM encryption (`lib/security/crypto.ts`) and signed short-lived download links (`lib/credit/document-service.ts`).
- Durable PostgreSQL worker pattern with atomic claims, leases, exponential backoff and dead-letter states (`lib/accounts/sync-service.ts`).
- Notification system (`createNotification`) and 15 new insurance notification types.
- Nexus Control RBAC, `requireControl`, `recordAdminAudit`, API response envelope, CSRF, rate limiting, pagination and validation conventions.
- Existing Raftline-backed wallet/payment orchestration — untouched.

## 3. New database models and migrations

Migrations: `20261119054748_release12_insurance_marketplace`, `20261119055821_release12_insurance_relations`.

22 new models: `InsuranceProvider`, `InsuranceProviderCapability`, `InsuranceProduct`, `InsuranceProductVersion`, `InsuranceProductDocument`, `InsuranceQuote`, `InsuranceQuoteSnapshot`, `InsuranceApplication`, `InsurancePolicy`, `InsurancePremiumSchedule`, `InsurancePremiumPayment`, `InsuranceRenewal`, `InsuranceClaim`, `InsuranceClaimStatusHistory`, `InsuranceDocument`, `InsuranceConsent`, `InsuranceProviderWebhook`, `InsuranceProviderSync`, `InsuranceActivity`, `InsuranceNotificationPreference` (+ application documents and supporting relations). All money is integer minor units. Provider references are uniquely scoped per provider. Ownership indexes enforce user isolation.

## 4. New API endpoints

Marketplace: `GET /api/insurance/categories`, `/providers`, `/products`, `/products/:id`, `/products/:id/documents`, `POST /products/compare`.
Quotes: `POST/GET /api/insurance/quotes`, `GET /quotes/:id`, `POST /quotes/:id/refresh`.
Applications: `POST/GET /api/insurance/applications`, `GET /applications/:id`, `POST /applications/:id/submit`, `/cancel`, documents upload/list.
Policies: `GET /api/insurance/policies`, `/policies/:id`, `/policies/:id/premiums`, `/policies/:id/renewals`, `POST /policies/:id/renewal/quote`, documents.
Claims: `GET/POST /api/insurance/claims`, `GET /claims/:id`, `GET /claims/:id/history`, `POST /claims/:id/submit`, documents.
Customer controls: `GET/POST /api/insurance/consents`, `POST /consents/:id/revoke`, `GET /activity`, `GET /preferences`.
Documents: `GET/DELETE /api/insurance/documents/:id`, `GET /documents/:id/download`.
Webhook: `POST /api/insurance/webhooks/:providerCode`.
Control: `GET /api/control/insurance/overview`, `/applications`, `/events`, `/consents`, `POST /run`.

## 5. Frontend pages and components

Customer pages under `app/(customer)/insurance`: overview, marketplace, product detail, comparison, quotes, applications, policies, claims, document centre, privacy/consent. Components: `components/insurance/insurance-nav.tsx`. Control page: `app/control/insurance/page.tsx`. Customer nav link added. Quotes/applications/policies/claims states show verified data and clear unavailable/empty/error states.

## 6. Provider integrations and actual status

| Capability | Status |
| --- | --- |
| Provider abstraction, capability declarations, catalogue/quotes/applications/policies/renewals/claims/webhooks | Architecture-ready |
| Sandbox insurer (`sandbox-insurer`) | Sandbox only — `NEXUS_INSURANCE_SANDBOX_ENABLED` |
| Real insurer / broker / web aggregator | Not connected — prerequisites unmet |
| Premium payment via payment orchestration | Architecture-ready, not connected to a verified provider arrangement |

## 7. Background workers and webhook handlers

`startInsuranceWorker()` registered in `instrumentation.ts`. Jobs: catalogue sync, quote expiry, webhook event processing via `InsuranceProviderSync` with atomic claim/lease/backoff/dead-letter. `receiveWebhook` verifies HMAC-SHA256 signatures, validates structure, deduplicates by `(providerId, eventId)`, persists the original payload, and enqueues async processing. Only verified events change domain status.

## 8. Nexus Control additions

`insurance:read` / `insurance:write` permissions for OPERATOR/VIEWER; `/control/insurance` navigation entry; Insurance Operations page (provider health, sync backlog, webhook failures, last sync); read-only aggregate APIs and an audited provider-sync run action. No admin can fabricate a policy, override provider-confirmed coverage, or mark an unverified claim approved.

## 9. Security and privacy safeguards

Explicit consent recorded before provider submission; revocation enforced at the sharing boundary (`requireActiveConsent`). Ownership checks on every customer resource. AES-256-GCM encrypted documents with signed 5-minute download links, MIME/size validation, malware-scan status field and access/download audit events. Sensitive payloads never returned to the browser. Strong tenant isolation, masked policy numbers, RBAC, rate limits, CSRF, structured audit logs.

## 10. Tests executed and results

- `pnpm typecheck` — pass.
- `pnpm lint` — pass.
- `pnpm build` — pass (116 static pages).
- `pnpm test:unit` — 91 passed (including 11 new insurance unit tests).
- `pnpm test:integration` — 122 passed (including 12 new Release 12 integration tests).
- `pnpm test:e2e` — 20 passed (including 2 new Release 12 E2E tests), against a production build with `E2E_TEST_MODE=true` to avoid shared rate-limit contention.

Coverage includes product normalization, capability declarations, lifecycle transitions, premium/renewal math, webhook signature verification and deduplication, consent validation, per-user isolation, revoked-consent enforcement, verified-only status transitions and Control PII masking.

## 11. Environment variables required

`NEXUS_INSURANCE_SANDBOX_ENABLED` (default `false`). `AUTH_SECRET` (>= 32 chars) and `DATABASE_URL` are reused. See [environment-setup.md](environment-setup.md) and `.env.example`.

## 12. Commands to run locally on Windows

```powershell
pnpm install
pnpm --filter @nexus/database db:generate
# Ensure PostgreSQL on localhost:5433 and Raftline nodes on 8001-8005 are running
pnpm --filter @nexus/database exec prisma migrate deploy
pnpm dev
```

For verification: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`.

## 13. Known limitations and unfinished items

- No real insurer is integrated; the marketplace is demonstration-only until onboarding prerequisites are met.
- No production premium payment flow; external provider payment instructions only, with status tracked only when verifiable.
- Document malware scanning reports `NOT_AVAILABLE` until an AV scanner is configured.
- Renewal actions require explicit user confirmation; no automatic renewal.
- Provider webhook support varies; controlled polling is used where webhooks are unavailable.

## 14. Confirmation

Releases 1–11 were not rewritten or unnecessarily refactored. Release 12 adds new files and extends existing modules additively (notification types, Control permissions, nav entries, worker registration). All Release 1–11 unit, integration and E2E suites still pass.
