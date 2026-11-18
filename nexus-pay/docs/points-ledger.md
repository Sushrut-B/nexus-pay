# Points ledger design

- **Append-only:** entries are never edited or deleted. Corrections use `REVERSE`,
  `EXPIRE` or `ADJUST` entries.
- **Idempotency:** every entry has a unique `idempotencyKey`. Earning uses
  `r8earn:<paymentRef>:<campaignId|base>`, redemption `r8redeem:<reference>`,
  expiry `r8expire:<entryId>`, referral `r8referral:<attribution>:<type>`.
- **Balance integrity:** debits use `UPDATE ... WHERE availablePoints >= cost` so a
  concurrent redemption can never overdraw. `balanceAfter` is stored on each entry.
- **Earning:** 1 point per ₹100 for eligible settled merchant payments plus campaign
  bonuses (e.g. 5 points per ₹100). P2P/internal transfers are excluded by design —
  only `MerchantPayment` rows are scanned.
- **Expiry:** entries with `expiresAt` are expired by the worker using the passed
  expiry date; historical entries remain. Earliest-expiring-first allocation is
  applied when points are debited by the ledger query order.
- **Reconciliation:** `reward_accounts.availablePoints` must equal the sum of ledger
  `points`. `GET /api/control/rewards/reconciliation` reports mismatches without
  repairing them.
