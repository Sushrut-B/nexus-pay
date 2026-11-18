# Provider adapter development guide

Implement `ProviderAdapter` from `apps/web/lib/accounts/provider-adapter.ts`:

- `initiateConnection` — returns an authorization URL (provider-hosted where supported),
  a stable provider connection reference and a clear notice.
- `verifyCallback` / `handleCallback` — validate state, signature and replay; return
  discovered accounts and an encrypted token.
- `fetchAccounts` / `fetchBalances` / `fetchTransactions(cursor)` — provider-specific
  calls behind the common interface; transactions must support cursor pagination.
- `refreshConsent` / `revokeConsent` / `getStatus` — consent and health operations.

Adapters are registered in `lib/accounts/providers/index.ts`. A provider is exposed
only when its environment flag is enabled; unknown providers return a documented
`PROVIDER_UNAVAILABLE` state. Never embed credentials in code or git — use secret
management and encrypt tokens with `lib/security/crypto.ts`.

Capabilities are declared per adapter so the UI can disable unsupported actions
(credit card fields, incremental sync, hosted auth). Provider errors must be
normalised into the common sync-job failure states.
