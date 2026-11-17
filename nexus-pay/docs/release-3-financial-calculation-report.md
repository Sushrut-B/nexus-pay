# Release 3 — Financial Calculation Report

Scope: contacts, payment requests, group expenses, split allocation, balance
calculation, debt simplification and settlement accounting.
Date: 17 November 2026.

## 1. Money representation

All amounts are integer minor units (paise), stored as `BigInt` in PostgreSQL
and converted to safe JavaScript integers only after validation. Input strings
are parsed by `parseMajorToMinor` using `BigInt`; no floating-point arithmetic
is used for money.

## 2. Split allocation

`apps/web/lib/social/split-service.ts` implements four methods:

| Method | Input | Rule |
| --- | --- | --- |
| `EQUAL` | selected participants | Equal weights of 1. |
| `CUSTOM` | exact `amountMinor` per participant | Sum must equal the expense total exactly. |
| `PERCENTAGE` | integer percentages | Must total exactly 100. |
| `SHARES` | integer share ratios | Total shares must be positive. |

### Deterministic remainder rule

For weighted methods, each participant's exact share is
`total × weight / totalWeight`. We allocate `floor(exact)` first, then distribute
the remaining paise one at a time to participants with the largest fractional
remainder (`total × weight mod totalWeight`). Ties are broken by original
participant order. Therefore:

- `₹100 / 3` → `₹33.34, ₹33.33, ₹33.33` (3334, 3333, 3333 paise).
- The same input always yields the same allocation.
- `sum(shares) === total` in every accepted allocation.

Invalid inputs (duplicate participants, non-positive total, weights that do not
sum correctly) throw before any database write.

## 3. Balance formula

`apps/web/lib/social/balance-engine.ts`:

```
net(member) = paidBy(member)
            − assignedShares(member)
            + settlementsPaid(member)
            − settlementsReceived(member)
```

Positive net means the member is owed; negative means they owe. The engine
checks that:

- every expense's split total equals its recorded total;
- every participant and payer belongs to the group;
- `sum(all net balances) === 0`.

If any check fails, a `BalanceEngineError` is raised and the API returns
`500 INTERNAL_SERVER_ERROR`. The UI never displays a partial or guessed balance.

Only settlements with status `SETTLED` are included. `PROCESSING`, `UNKNOWN`,
`FAILED` and `RECONCILIATION_REQUIRED` settlements do not change any balance.

## 4. Debt simplification

`simplifyDebts` sorts creditors by descending balance and debtors by descending
debt (user id as deterministic tie-break), then greedily matches the largest
pair with `min(credit, debt)`. This reduces transfer count but never alters the
recorded expense allocations or anyone's actual obligation. It is presentation
and planning only.

## 5. Settlement integrity

- A settlement is created with a unique durable `clientRequestId` and a
  Raftline-style idempotency key.
- The payee and payer must be active group members, cannot be the same person,
  and the amount cannot exceed the pairwise obligation derived from expenses
  minus confirmed settlements.
- `POST /api/groups/[id]/settlements` creates the record and immediately runs
  the existing Release 2 payment engine with the same client request id.
- The settlement becomes `SETTLED` only when `PaymentView.status === "SETTLED"`
  with a verified `paymentRef`. Rejections become `FAILED`; ambiguous outcomes
  become `RECONCILIATION_REQUIRED`. Repeated confirmations reuse the same
  payment intent and cannot double-debit or double-reduce balances.
- Partial payments are retained as real payments and reduce only their amount.
- Expenses cannot be hard-deleted once any group settlement is confirmed;
  edits write an activity/audit trail and recalculate balances.

## 6. Test evidence

| Test | Result |
| --- | --- |
| `pnpm test:unit` (6 files) | 46 passed — includes 6 split tests and 5 balance/simplification tests |
| `pnpm test:integration` (3 files) | 6 passed — Release 3 covers contacts, request payment, expense/balances/partial settlement/duplicate protection against live Raftline and PostgreSQL |
| Release 3 E2E Scenario A | Passed — request accepted, paid with verified transfer, visible to both users |
| Release 3 E2E Scenarios B–E | Passed — group, equal split, balances, partial settlement and remaining dues |

## 7. Known limits

- Percentage splits require integer percentages; an amount-based percentage
  with more than two decimals is rejected rather than silently rounded.
- Debt simplification is greedy, not globally minimal for very large groups.
- Removing a member does not rewrite historical expenses; they remain
  understandable because paid-by and split user ids are retained.
- No real bank/UPI rails; all money is sandbox INR inside Raftline.
