# Merchant refund workflow and backend limitation

**Raftline has no refund, reversal or chargeback endpoint.** This was verified in the Java source (`PaymentSettlementEngine`, `RaftHttpServer`). No endpoint exists and no ordinary settlement can be safely reversed.

## What is implemented

- `POST /api/merchant/refunds` creates a `REQUESTED` refund case with amount, reason and FULL/PARTIAL classification.
- Server validation: only settled payments, no refund above the remaining refundable amount, full refunds must cover the remainder.
- Nexus Control → **Merchant Refunds** allows APPROVE/REJECT with a mandatory reason; every decision is audited.
- Webhook outbox records `refund.requested` and `refund.succeeded`/`refund.failed` review events.

## What is deliberately not implemented

- No automatic money movement.
- No manual balance edits.
- No fake `SUCCEEDED` settlement.
- No claim that a refund was paid.

Approved requests carry the note: "Approved for review only. Raftline has no verified refund/reversal operation; no money was moved."

Customer and merchant histories show the actual outcome: original settled payment plus recorded refund request status.
