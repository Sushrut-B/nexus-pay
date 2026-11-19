# Release 12 — Insurance Marketplace: Audit & Implementation Plan

## Phase 0 — Existing system audit

Verified at HEAD `a3de3d5`: customer auth/session/profile, Raftline-backed wallet
and settlement engine, payments, notifications, Release 4 finance, Release 9
financial intelligence (classification/aggregation/forecasts/health), Release 10
external accounts (provider abstraction, AES-256-GCM encryption, secure documents,
verified callbacks, durable sync worker), Release 11 credit marketplace (lender
adapter, quotes/applications, policy-like document storage, webhook verification,
Control RBAC) are all present and green (80 unit / 110 integration / 18 E2E).
Reusable conventions: `ApiError`/`jsonOk`, CSRF/rate-limit/readJsonBody, `createNotification`,
`recordAdminAudit`, `*worker-bootstrap.ts` global guards with atomic claims/leases,
and env-gated sandbox providers with documented unavailable states.

## Raftline / financial boundary
Insurance policies, quotes, premiums and claims are metadata only. Raftline remains
authoritative for wallet money. No insurance value is represented as a wallet
balance and no second ledger is introduced.

## Regulatory research
Official sources consulted: IRDAI (Insurance Web Aggregators) Regulations
(2013/2017) and surrounding IRDAI guidance. Operating as an insurance web
aggregator, broker, corporate agent or insurer requires registration. Nexus Pay
has no verified authorization. Therefore **no real insurer, quote, policy or
claim is fabricated**: only a modular provider adapter plus an environment-gated,
clearly labelled sandbox is implemented; all production prerequisites are documented.

## Implementation plan
1. Provider abstraction + env-gated sandbox + unavailable states.
2. Prisma schema: providers, products, versions, quotes, applications, policies,
   premiums, renewals, claims, consents, webhooks/sync, activity/preferences.
3. Services: catalogue, quotes, applications, policies, premiums, claims, consents,
   documents (reusing AES-256-GCM + signed links), webhook processing, Control and worker.
4. Customer APIs and UI (marketplace → policies → claims → privacy), Control Insurance Operations.
5. Unit/integration/security/E2E tests and docs; final gates and regression.

## Safety rules
- Estimate ≠ quote; application ≠ issued policy; payment ≠ verified coverage.
- Policy status only from verified provider evidence; no admin overrides.
- Explicit consent before sharing data with a provider; revocation enforced.
- No fake logos, ratings, certifications or "IRDAI approved" claims.
