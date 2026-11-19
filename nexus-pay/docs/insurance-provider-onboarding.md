# Insurance Provider Onboarding & Adapter Guide

## Provider integration status

| Capability | Status |
| --- | --- |
| Adapter interface, registry, env gating, unavailable states | Fully implemented |
| Sandbox demonstration insurer | Available only in sandbox (`NEXUS_INSURANCE_SANDBOX_ENABLED=true`) |
| Real insurer / broker / web aggregator integration | Architecture-ready, not connected |
| Production premium payment | Architecture-ready, not connected |
| Claim submission | Sandbox only; real providers vary |

## Regulatory prerequisites (not yet met)

Operating as an insurer, insurance broker, corporate agent or insurance web aggregator requires registration under IRDAI rules (including the IRDA (Insurance Web Aggregators) Regulations 2013/2017 and subsequent guidance). Nexus Pay has no verified authorization. The module therefore uses only a labelled sandbox and makes no regulatory claim. Before any production provider is enabled:

1. Obtain and record verified IRDAI authorization for the intended role.
2. Execute provider agreements using documented APIs and registered callback URLs; store credentials in secret management.
3. Obtain provider-approved product wording, exclusions, disclosures and quotation contracts.
4. Establish an explicit consent and privacy basis for sharing customer information.
5. Complete qualified legal/compliance review and explicit environment enablement.

## Implementing an adapter

Implement `InsurerAdapter` (`apps/web/lib/insurance/insurer-adapter.ts`):

- `getProviderDetails()` / `getCapabilities()` — declare identity and every supported capability.
- `getProducts()` / `getProductDetails(code)` — return verified, source-dated product data with integer minor units.
- `createQuote()` / `getQuote()` — return provider-generated quotes with validity windows and premium breakdowns.
- `submitApplication()` / `getApplicationStatus()` — idempotent submission keyed by `idempotencyKey`.
- `getPolicyDetails()` / `getPolicyDocuments()` — only provider-confirmed policy state.
- `getRenewalDetails()` — renewal information; never auto-renew.
- `initiateClaim()` / `getClaimStatus()` — only where supported.
- `verifyWebhook()` — verify signatures using the provider's documented method.

Add the adapter to `adapters` in `lib/insurance/providers/index.ts` and an enable predicate in `isInsurerEnabled()`. Never enable a production adapter without the prerequisites above.

## Webhook integration

`POST /api/insurance/webhooks/:providerCode` accepts signed events. Signatures are verified over `${timestamp}.${JSON.stringify(payload)}` with HMAC-SHA256 using `AUTH_SECRET` in the sandbox. Events are deduplicated by `(providerId, eventId)`, persisted, and processed asynchronously by the durable sync worker. Only `PROCESS`-eligible verified events mutate domain state. Providers without webhooks must be polled through controlled sync jobs.
