# Payment Risk Gateway Integration

The gateway is inserted into `POST /api/payments/send` **before** `getOrCreatePaymentIntent`:

1. Authenticate and validate the request (existing flow).
2. Resolve the recipient server-side (existing flow).
3. `evaluatePaymentRisk()` builds context from hashed recent security events and the behavioral baseline.
4. `evaluateRisk()` returns an explained decision and writes a `RiskEvaluation`.
5. A `TransactionRiskAssessment` links the decision to the original client request.
6. Blocking actions return a customer-safe message; no intent is created.
7. Allowed payments continue through the **existing, unchanged** payment engine exactly once.

## Invariants

- No wallet debit, balance change, payment intent creation or Raftline call occurs in the gateway.
- The original idempotency key and client request ID are preserved.
- A blocked payment is distinct from a rejected settlement.
- `PAYMENT_UNKNOWN` remains unknown; no blind retry.
- A settled suspicious payment produces a post-transaction assessment and optionally an investigation case, never a false reversal.
- Gateway unavailability is audited and follows the explicitly configured fallback; it never silently bypasses checks.

## Configuration

`NEXUS_FRAUD_GATEWAY_ENABLED`, `NEXUS_FRAUD_ENGINE_ENABLED`, `NEXUS_FRAUD_FALLBACK_ACTION`. To bypass the gate entirely in a test environment, set the gateway flag to false; the rest of the payment flow is unchanged.
