# Recurring billing engine & webhook/invoice integrity

## Worker

`lib/subscription/billing-worker.ts` starts once per Node process from
`instrumentation.ts` (and can be triggered by an authorized merchant via
`POST /api/merchant/billing/run`). `runBillingWorker` performs three passes:

1. Mature free trials → activate and create their first paid occurrence.
2. Finalize end-of-period cancellations without charging again.
3. Claim and process due occurrences (new, backed-off retries, unresolved).

Multiple workers are safe: a `billingOccurrence` is claimed with an atomic
`updateMany` on status + lease + `nextAttemptAt`, with a 5-minute lease.

## Occurrence identity and idempotency

- Unique `(subscriptionId, occurrenceNumber)` and unique `idempotencyKey`
  (`r7sub:<subscriptionId>:<n>`).
- The stable occurrence key is the payment-intent `clientRequestId`, so repeated
  processing never creates a second debit for the same period.
- A definitively rejected payment may be retried with a deterministic
  `:attempt:<n>` suffix. An uncertain outcome always reuses the exact original
  request id and is reconciled via Raftline transaction lookup before retrying.

## Outcome policy

| Outcome | Occurrence | Invoice | Subscription | Schedule |
| --- | --- | --- | --- | --- |
| Settled | SETTLED | PAID | ACTIVE | Advance; pre-create next occurrence |
| Rejected (retryable) | FAILED, backoff | PAST_DUE | PAST_DUE | Not advanced |
| Rejected (permanent) | DEAD_LETTER | PAST_DUE | PAST_DUE | Not advanced |
| Unknown / timeout | RECONCILIATION_REQUIRED | PROCESSING | unchanged | Not advanced |
| Cancelled | SKIPPED | unchanged | CANCELLED | Stopped |

Raftline has no refund/reversal operation — a settled renewal cannot be reversed
through this platform.
