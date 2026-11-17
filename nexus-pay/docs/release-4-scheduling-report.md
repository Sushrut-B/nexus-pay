# Release 4 — Scheduled Execution Reliability Report

Date: 17 November 2026

## Architecture

- PostgreSQL-backed `scheduled_payments` and `scheduled_payment_executions`.
- Server-side worker started once from `instrumentation.ts`; also runnable via
  `scripts/run-scheduler.ts` and triggerable manually via
  `POST /api/scheduled-payments/run`.
- No browser timers or `setInterval` in client components.

## Idempotency and concurrency

1. For each due schedule, the worker derives a stable execution key:
   `${scheduleId}:${scheduledFor.toISOString()}`.
2. It creates the execution row if absent (unique constraint on `executionKey`).
3. It atomically claims the row with
   `updateMany(where: id, status in [PENDING, RETRY_PENDING], nextAttemptAt <= now)`,
   setting status `PROCESSING` and incrementing `attemptCount`. A second worker
   sees zero affected rows and skips the occurrence.
4. The same key becomes the payment intent's `clientRequestId`, so the Release 2
   payment engine reuses the original durable intent and Raftline idempotency key.

A verified live test ran the scheduler twice for one due occurrence:
- first run: execution `SETTLED`, wallet debited exactly ₹100;
- second run: no additional execution, no additional debit.

## Outcome mapping

| Payment result | Execution | Schedule |
| --- | --- | --- |
| `SETTLED` with verified ref | `SETTLED`, paymentRef stored | execution count +1, next date calculated, or `COMPLETED` |
| Definitive rejection (insufficient funds, bad account, etc.) | `FAILED` | `REQUIRES_ATTENTION`, notification |
| Ambiguous / transient, attempts < 3 | `RETRY_PENDING`, backoff | remains `ACTIVE` |
| Ambiguous / transient, attempts ≥ 3 | `FAILED` | `REQUIRES_ATTENTION`, notification |

Retry policy: maximum 3 attempts, 60s × attempt backoff. Retryable categories
are ambiguous outcomes and transport/rate-limit errors; definitive ledger
rejections are not retried automatically. Retries reuse the same payment intent
and never create a new transfer after a timeout.

## State separation

Scheduler execution state (`PENDING`/`PROCESSING`/`SETTLED`/`FAILED`) is stored
separately from the actual payment state. Only a verified `SETTLED` payment
advances group/wallet effects and marks the execution `SETTLED`.

## Verified scenarios

| Scenario | Result |
| --- | --- |
| Schedule creation | Active with correct `nextExecutionAt` |
| Pause / resume / cancel | Guarded state transitions verified |
| Due execution detection and claim | Worker settled one occurrence |
| Duplicate worker execution | No second debit or execution |
| Insufficient funds | Non-retryable rejection → `REQUIRES_ATTENTION` |
| Leader change / network timeout | Ambiguous outcomes retry the same intent; no fresh payment |
| Next execution calculation | Monthly schedule advanced beyond `now` |
| Execution history | One `SETTLED` record with a payment reference |

## Known limitations

- The in-process interval is suitable for a single long-running Node server;
  for multi-instance production deployment, run `scripts/run-scheduler.ts` as
  an external worker. The atomic claim already supports multiple workers.
- Scheduled payments operate only inside the simulated Nexus Pay environment;
  no bank mandates or UPI AutoPay are integrated.
