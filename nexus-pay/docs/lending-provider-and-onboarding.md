# Lending provider adapter and onboarding

## Adapter
Implement `LenderAdapter` (`apps/web/lib/credit/lender-adapter.ts`): product
catalogue, offers, eligibility, application submission, status, documents, offer
acceptance, disbursement confirmation, repayment schedule and webhook signature
verification. Capabilities are declared per provider so unsupported actions are
disabled in the UI. Register adapters in `lib/credit/providers/index.ts`.

## Sandbox
Set `NEXUS_CREDIT_SANDBOX_ENABLED=true`. The `sandbox-lender` adapter exposes two
clearly labelled test products, deterministic offers, pre-assessment-only
eligibility, idempotent application submission and a provider repayment schedule.
Webhook signatures are HMAC-SHA256 over `timestamp.rawBody` using `AUTH_SECRET`.

## Production prerequisites (not implemented)
- A Regulated Entity relationship and clearly defined LSP role.
- Compliance with RBI Digital Lending Guidelines (2022) and Digital Lending
  Directions (2025), including Key Fact Statement, cooling-off, direct RE
  disbursement/repayment, Default Loss Guarantee rules and Digital Lending App
  reporting.
- Executed contracts, registered callbacks and credentials in secret management.
- Verified consent/disclosure and document-retention basis.
- Qualified legal and compliance sign-off plus explicit enablement.

No production lender or regulatory approval is claimed.
