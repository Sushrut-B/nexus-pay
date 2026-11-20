# Bill Payment Architecture

## Boundaries

- **Raftline** is authoritative for wallet balances and committed settlements. No other ledger exists.
- **Biller provider** is authoritative for biller identity, bill details, outstanding amount, due date, payment acceptance, biller confirmation and reversal/refund status.
- **Nexus Pay** keeps orchestration records connecting `paymentRef` (Raftline) to `providerRef` (provider). These are never the same transaction.

## Two-system state machine

```
CREATED → CUSTOMER_CONFIRMATION_REQUIRED → PAYMENT_AUTHORIZED
        → WALLET_SETTLEMENT_PENDING
        → WALLET_SETTLED ──provider──> PROVIDER_SUBMISSION_PENDING
                                      → PROVIDER_PROCESSING → BILLER_CONFIRMED
Failure branches: FAILED, UNKNOWN, RECONCILIATION_REQUIRED, REFUND_PENDING, REFUNDED, PARTIALLY_REVERSED
```

Safety rules:

- Failed wallet settlement never reaches the provider.
- Unknown wallet/provider outcome is never retried with a new key; it is reconciled.
- A wallet debit is recorded as `WALLET_SETTLED`, not `BILLER_CONFIRMED`.
- A provider rejection after settlement preserves the settlement and opens a reconciliation case; no fabricated refund.
- Duplicate requests reuse the original intent and idempotency key.

## Distinctions

| Term | Meaning |
| --- | --- |
| Bill snapshot | Provider-fetched bill state at a point in time; may expire. |
| Wallet settlement | Verified Raftline debit; not bill payment confirmation. |
| Biller confirmation | Provider-reported acceptance; the only "paid" state. |
| Nexus Pay receipt | Payment record, never an official biller receipt. |
| Household assignment | Responsibility only; no money movement. |

## Provider integration status

Only `sandbox-biller` is configured, gated by `NEXUS_BILLING_SANDBOX_ENABLED`. No real biller, biller catalogue, plan or confirmation is connected. See `docs/biller-provider-guide.md` for onboarding prerequisites (including RBI/NPCI Bharat Connect authorisation) and the adapter interface.
