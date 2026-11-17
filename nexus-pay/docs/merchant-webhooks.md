# Merchant webhooks

## Events

`payment.created`, `payment.processing`, `payment.succeeded`, `payment.failed`, `order.created`, `order.paid`, `payment_link.created`, `payment_link.paid`, `refund.requested`, `refund.succeeded`, `refund.failed`.

Events are emitted from a durable outbox written in the same transaction as merchant state changes. Delivery is performed later by a background worker (`lib/merchant/webhook-worker.ts`) or `POST /api/merchant/webhooks/run`. Delivery failures never affect settlement. The worker has two phases: (1) fan out `PENDING` events into durable delivery rows, (2) attempt/retry deliveries that are due. A short `RETRY_PENDING` lease makes it safe for multiple workers.

## Signatures

Headers:

```
X-Nexus-Event-Id: <uuid>
X-Nexus-Timestamp: <unix ms>
X-Nexus-Signature: <hex HMAC-SHA256>
```

Signature = HMAC-SHA256 over the exact string `${timestamp}.${rawRequestBody}` using the endpoint signing secret. Verify using a constant-time comparison. The raw body must be used — do not re-serialize JSON.

## Delivery

- Exponential backoff: 60s × 2^(attempt−1), max 5 attempts, then `DEAD_LETTER`. Failed deliveries carry `nextAttemptAt`; the worker actually re-delivers them when due (verified by an integration test).
- Failed/dead-lettered deliveries can be reset for redelivery from the developer portal via `POST /api/merchant/webhooks/deliveries/{id}/retry`.
- 8-second timeout per delivery; each retry is re-signed with a fresh timestamp.
- Production endpoints require HTTPS.
- Secrets are shown once on creation/rotation; only the stored value is used for signing.
- A labelled test event is available via `POST /api/merchant/webhooks/{id}/test`.
- Delivery history is available at `GET /api/merchant/webhooks/deliveries`.

Payloads contain only integration fields (refs, amounts, statuses). No passwords, tokens, wallet credentials or internal Raftline secrets.
