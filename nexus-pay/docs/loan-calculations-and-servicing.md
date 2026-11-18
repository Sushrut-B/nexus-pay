# Loan calculations, application lifecycle and servicing

## EMI
Standard reducing-balance: `EMI = P × r × (1+r)^n / ((1+r)^n − 1)` with
`r = annualRateBps / 1_200_000`. Zero-interest loans divide principal evenly;
flat-rate products charge interest on original principal; variable and
provider-defined products defer to the provider's schedule. All results are
integer paise rounded to the nearest paisa, and assumptions are displayed.

## Lifecycle
`DRAFT → READY_FOR_SUBMISSION → SUBMITTED → ACKNOWLEDGED → UNDER_REVIEW →
… → OFFERED/ACCEPTED → DISBURSEMENT_PENDING → DISBURSED`, with withdrawal,
rejection, expiry and cancellation branches. Transitions are validated
server-side. Submission never means approval; disbursement requires a verified
provider event.

## Servicing
Provider-reported schedules are imported idempotently on
`(loanId, providerRef)`. Repayment confirmations are idempotent on a unique
provider reference and update the loan exactly once. Reminders are notifications
only — they never debit a wallet and never confirm a payment.
