# Release 9 — Financial Intelligence & Smart Money Management: Assessment

## Releases 1–8 verified present

Customer auth/wallets, Raftline settlement, merchant platform, subscriptions,
rewards and Nexus Control are implemented and green (63 unit, 79 integration,
12 E2E). Release 4 already provides insights, budgets, savings goals, scheduled
payments, recurring suggestions and PDF/CSV statements.

## Raftline verified

No new capabilities: `settle`, `authorize/capture/void`, `seed` (funding),
`accounts`, `account`, `transactions`, `idempotency`. No bank aggregation,
refund/reversal or external account access exists.

## Reuse plan

- **Source data:** derive all intelligence from existing persisted records —
  `TransactionRecord`, `PaymentIntent`, `FundingOperation`, `MerchantPayment`,
  `GroupSettlement`/`Expense`/`ExpenseSplit`, `ScheduledPaymentExecution`,
  `Subscription`/`BillingOccurrence`, `CashbackEntitlement`, `RewardLedgerEntry`.
- **Classification:** new read-only classification + aggregation services; no
  duplicated transaction records, no second ledger.
- **Charts/reports:** reuse the existing `pdf-lib`/CSV statement approach.
- **Workers:** extend the existing durable worker bootstrap with a single finance
  worker using atomic claims, leases and idempotent snapshots.
- **Assistant:** deterministic structured-query layer over authorised services.
  No LLM provider is integrated, so the fallback is the primary implementation;
  no API keys or unrestricted DB/ORM access are exposed.

## Key rules

1. Internal transfers and group expense/settlement pairs are never double-counted.
2. Cashback counts as inflow only after a verified wallet credit.
3. Reward points are never monetary income.
4. Planned savings and forecasts are labelled as estimates, never actual balances.
5. All aggregation is integer-paise, UTC internally and Asia/Kolkata for display.
6. User/merchant ownership enforced on every endpoint and report.
