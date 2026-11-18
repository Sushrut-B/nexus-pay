# Transaction classification rules

| Source | Category | Counted? | Rule |
| --- | --- | --- | --- |
| Successful P2P RECEIVED | INCOME | Inflow | Verified receipt only. |
| Successful P2P SENT | EXPENSE | Outflow | Unless its paymentRef belongs to a merchant payment or group settlement (deduplicated). |
| Funding operation | INTERNAL_TRANSFER | No | Simulated sandbox reserve credit, never income. |
| MerchantPayment SETTLED | EXPENSE / SUBSCRIPTION | Outflow | Counted once; subscription source tracked separately. |
| GroupSettlement SETTLED | GROUP_SETTLEMENT | No | Excluded so group expense reimbursement is not double-counted. |
| CashbackEntitlement CREDITED | CASHBACK | Inflow | Only after verified wallet settlement; never while pending. |
| RefundedMinor on MerchantPayment | REFUND | Adjustment | Reduces the original expense; never new income. |
| RewardLedgerEntry | REWARD | No | Non-cash points, never monetary income. |
| Unresolved / failed / unknown | — | No | Never counted until authoritative confirmation. |

Unclassified records are still shown in data quality reports; they are never
silently discarded. Completeness is the share of monetary records with an
explicit category or authoritative source label.
