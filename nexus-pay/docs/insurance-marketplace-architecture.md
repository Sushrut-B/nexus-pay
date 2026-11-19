# Insurance Marketplace — Architecture

## Boundary

Raftline remains authoritative for wallet money. Insurance quotes, applications, policies, premiums and claims are **metadata only**. No insurance value is ever represented as a wallet balance, and no second ledger is introduced. Premium payments are never silently debited; a verified provider payment arrangement is a prerequisite for any payment-orchestration integration.

## Layers

1. **Adapter** — `lib/insurance/insurer-adapter.ts` defines `InsurerAdapter` with explicit `InsurerCapabilities`. Every operation an adapter does not support is declared false; callers must check capabilities.
2. **Registry** — `lib/insurance/providers/index.ts` gates adapters by environment (`NEXUS_INSURANCE_SANDBOX_ENABLED`). Unconfigured providers produce `503` with documented prerequisites, never fabricated data. `ensureInsurerRecords()` upserts provider/capability rows with `AVAILABLE`/`UNAVAILABLE` status.
3. **Sandbox adapter** — `sandbox-insurer.ts` is the only adapter, clearly labelled `SANDBOX` and emitting test fixtures only.
4. **Services** — catalogue, quotes, applications, policies, premiums/renewals, claims, consents, documents, webhooks and Control.
5. **APIs / UI** — customer and Control REST endpoints and Next.js pages.

## State-authority rules

- Estimate ≠ quote. The UI labels sandbox fixture values and never shows an estimate as a confirmed quote.
- Application ≠ policy. `APPROVED` never activates coverage; only a verified `POLICY_ISSUED` webhook can call `createPolicyFromProvider()`.
- Payment ≠ coverage. Premium status changes require provider confirmation; no local activation.
- Provider status is authoritative. Policy/claim status values are stored only from verified provider evidence.

## Data model

See the Prisma schema and the migration SQL. Money is stored as integer minor units. Provider references are unique per provider. Policy numbers are masked in DTOs. Documents are encrypted at rest and never publicly accessible.

## Consent

`InsuranceConsent` records purpose, data categories, shared fields, version, timestamps and revocation. `requireActiveConsent()` is enforced at provider submission. Revocation stops all future provider data sharing.
