# Travel Architecture

## Boundaries

- Raftline is authoritative for wallet balances and committed settlements; no second ledger.
- The booking provider is authoritative for availability, fare, booking confirmation, ticket issuance, cancellation and refund status.
- Nexus Pay keeps orchestration records linking Raftline `paymentRef` to provider `providerRef`. They are never the same transaction.

## State machine

```
DRAFT → VALIDATION_PENDING → READY_FOR_PAYMENT → PAYMENT_PENDING
      → PAYMENT_SETTLED → PROVIDER_SUBMISSION_PENDING → PROVIDER_PROCESSING → CONFIRMED
Failure branches: FAILED, UNKNOWN, RECONCILIATION_REQUIRED, CANCELLATION_PENDING,
CANCELLED, REFUND_PENDING, PARTIALLY_REFUNDED, REFUNDED, COMPLETED
```

A wallet debit never produces a booking-success screen. Only provider confirmation yields CONFIRMED, and only a retrieved provider ticket is shown as issued.

## Provider integration status

Only `sandbox-travel` is configured, gated by `NEXUS_TRAVEL_SANDBOX_ENABLED`. No IRCTC, airline, hotel, bus, metro or mobility partnership exists. See `docs/travel-provider-guide.md` for prerequisites and the adapter interface.

## Distinctions

| Term | Meaning |
| --- | --- |
| Cached search result | Provider-reported at a past time; may be stale. |
| Revalidated fare | Fresh provider price with a validity window; still not a booking. |
| Confirmed booking | Provider-confirmed reservation. |
| Issued ticket | Provider-supplied ticket document retrieved into private storage. |
| Refund pending | No confirmed refund; never shown as completed. |
