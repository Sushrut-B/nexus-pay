# Campaign configuration & merchant workflow

## Types
`POINTS_MULTIPLIER`, `CASHBACK`, `FIXED_DISCOUNT`, `PERCENTAGE_DISCOUNT`,
`BONUS_POINTS`, `REFERRAL_BONUS`, `FIRST_TRANSACTION`, `MERCHANT_SPECIFIC`,
`LIMITED_TIME_OFFER`.

## Lifecycle
`DRAFT → PENDING_APPROVAL → APPROVED → ACTIVE → PAUSED/EXHAUSTED/EXPIRED`.
Merchants create drafts and submit; Nexus Control approves or rejects with a reason.
Only approved campaigns become active via the worker at `startAt`. Approval and
rejection are permission-checked and audited.

## Budget
`campaign_budgets` tracks allocated, reserved and consumed paise plus points.
Reservations are atomic and expire after 30 minutes; the worker releases them.
Exhausted campaigns stop issuing rewards automatically.

## Promo codes
Merchants may attach a unique promo code. `POST /api/rewards/promo/validate` checks
status, window, spend, per-user/global limits and budget, computes the discount
server-side in integer paise, and reserves capacity. The existing checkout must
consume the reservation with `consumePromoCode` after verified settlement. Discounts
from the client are never trusted.
