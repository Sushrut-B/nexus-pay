# Cashback processing lifecycle

```
ELIGIBILITY_PENDING → ELIGIBLE → PENDING_CREDIT → PROCESSING → CREDITED
                                      ↓              ↓
                                    FAILED   REQUIRES_RECONCILIATION
                                      ↓
                              PENDING_CREDIT (backoff)
```

## Rules

- One entitlement per `(userId, campaignId, transactionRef)`.
- `clientRequestId` is a deterministic UUID derived from the entitlement key, so
  repeated worker passes reuse the exact same funding operation and Raftline
  idempotency key.
- Uncertain outcomes never generate a new key; they are reconciled with Raftline's
  transaction lookup before any new attempt.
- Budget is reserved atomically (`UPDATE ... WHERE allocated - consumed - reserved >= amount`)
  and committed only after verified settlement.
- At most three automatic attempts; failures dead-letter to `FAILED` with a customer
  notification. No money is moved on failure.
- Raftline has no reversal endpoint — credited cashback cannot be reversed through
  this platform. The `REVERSED` status exists for a future verified reversal capability.

Cashback is labelled as **sandbox promotional credit**; it is not real money.
