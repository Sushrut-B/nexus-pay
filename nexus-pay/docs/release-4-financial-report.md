# Release 4 — Financial Calculation Verification Report

Date: 17 November 2026

## Transaction inclusion policy

Analytics are derived from `TransactionRecord` rows that are:

- owned by the authenticated customer;
- `status = SUCCESSFUL`;
- `kind = P2P`;
- associated with a non-null ledger `paymentRef`.

Excluded: simulated funding, failed/unconfirmed/processing payments, cancelled
or reversed operations, and duplicate idempotent replays (the read model is
unique per `(user, paymentRef)`). Group expense obligations are metadata and
never counted as payments; a group settlement is a real P2P payment counted
exactly once. Internal transfers and personal transfers are excluded from the
"spending" aggregate. Funding is never treated as income.

## Verified calculations

| Area | Rule | Verified result |
| --- | --- | --- |
| Inflow | Sum of successful received P2P amounts | A recipient saw `receivedMinor = 50,000` after a verified ₹500 transfer |
| Outflow | Sum of successful sent P2P amounts | Sender saw `sentMinor = 50,000` |
| Net cash flow | inflow − outflow | `-50,000` for a single outgoing payment |
| Eligible spending | Outgoing categorized in spending categories | Equals the categorized outgoing amount; transfers/income/group obligations excluded |
| Category aggregation | Grouped by effective category from manual or rule resolution | Subscriptions category held the full ₹500 after categorization |
| Period comparison | `(current − previous) / previous`, `null` when previous is 0 | No division by zero; "New" displayed for zero previous period |
| Weekly/daily buckets | Derived from actual transaction timestamps | Buckets sum to the period totals |
| Savings estimate | Positive net cash flow with both inflows and outflows | `null` when unsupported |
| Budget utilization | Eligible spending / budget amount | 40,000 / 60,000 = 66.7% |
| Budget alerts | Once per (budget, periodStart, threshold) | 50% alert recorded once; reopening produced no duplicate |
| Goal progress | RECORDED contributions / target | Planned contributions do not count; completion at 100% |
| Recurring detection | Repeated amount + counterparty with regular interval | Suggestion created, no automatic schedule |
| Statement totals | Verified records in date range | PDF/CSV totals matched 25,000 outflow, 1 transaction |

## Deterministic rules

- Paise remainders use largest-remainder allocation with original-order tie
  breaking (Release 3 engine, unchanged).
- Categorization rules: highest priority wins; ties broken by creation order;
  manual choices always override rules.
- Schedule frequency advances by UTC calendar units (day/week/month/quarter/year).

## Test evidence

| Suite | Result |
| --- | --- |
| `pnpm test:unit` | 50 passed across 7 files (includes 4 Release 4 engine tests) |
| `pnpm test:integration` | 21 passed across 5 files (includes 7 Release 4 live tests) |
| Release 4 E2E smoke | 1 passed (all new screens rendered and planning workflows completed) |

## Known limitations

- No read-model cache; analytics query authoritative records on demand. This is
  simpler and always fresh for the current data volume.
- Percentage/recurring suggestions require repeated identical amounts; similar
  but varying amounts are intentionally not guessed.
- Historical opening/closing statement balances are reconstructed from verified
  transaction receipts and labelled unavailable when no receipt exists.
