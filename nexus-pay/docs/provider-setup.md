# Provider setup and availability

## Sandbox (test only)
Set `NEXUS_EXTERNAL_SANDBOX_ENABLED=true` and call `POST /api/accounts/connect` with
`providerCode: "sandbox"`. The sandbox adapter performs a simulated local
authorisation callback and returns deterministic test accounts from "Sandbox Test
Bank". Every screen and API response labels this data as sandbox. No real financial
institution is contacted and no real account data is used.

## Production prerequisites (not implemented in this release)
A real integration requires, at minimum:

1. A verified regulatory role and agreements for the target market. In India this
   means confirming participation in the RBI-regulated Account Aggregator ecosystem
   (Financial Information User / AA relationship) with qualified compliance advice.
2. Executed provider contracts, registered callback URLs and client credentials or
   certificates held in secret management.
3. Provider-documented consent, authentication, callback-signature and pagination
   contracts implemented in a dedicated adapter.
4. Legal review of consent language, retention and data minimisation, plus explicit
   environment enablement.

Until these exist, every non-sandbox provider returns a connection-unavailable state
with the prerequisites listed. No production connectivity or approval is claimed.
