# Release 11 — Credit marketplace architecture

Nexus Pay is a **credit discovery, application workflow and loan-management
platform**. It is not a lender, NBFC, bank, credit bureau or Regulated Entity in
this release. No real loan is originated, approved, disbursed or collected.

```
Customer → /api/credit/** → catalogue / eligibility / application / loan services
                                  ↓
                       lender provider adapter registry
                       ├── sandbox-lender (env-gated test fixtures)
                       └── production lenders (not configured)
                                  ↓
              verified provider webhooks → sync worker → loan state
```

Lending Service Provider (LSP) and Regulated Entity (RE) roles are kept distinct
in terminology and data. Only verified provider evidence may change an
application or loan state. No wallet is debited for repayments.
