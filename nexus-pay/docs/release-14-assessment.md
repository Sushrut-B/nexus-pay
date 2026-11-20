# Release 14 — Bill Payments & Recharges: Audit & Implementation Plan

## Phase 0 — Verification

Baseline commit `c65d0a7` (`feat(nexus-pay): Release 13 fraud intelligence and transaction security`) contains Releases 1–13 and is clean. A detailed reusable-component inventory is recorded in `docs/bill-payments-reuse-inventory.md`.

## Regulatory research (official sources)

Sources reviewed: RBI's BBPS notification (authorisation of BBPCU/BBPOUs under the Payment and Settlement Systems Act, 2007), NPCI Bharat BillPay / Bharat Connect procedural guidelines (November 2025) and circulars (biller-category reviews, UPMS for autopay, remitter details, eligible payment modes).

- NPCI Bharat BillPay Limited (NBBL) operates Bharat Connect/BBPS as the authorised central unit; **BBPOUs require RBI authorisation** (banks/non-banks intimate DPSS/RBI before operating as OUs under current guidelines).
- Documented flows include **Fetch and Pay**, prepaid recharge, and **UPMS**-based recurring/autopay. Categories include electricity, water, piped gas, LPG, broadband, landline, mobile postpaid/prepaid, DTH and FASTag.
- Nexus Pay has **no verified authorisation**. Therefore: no BBPS/BBPOU/Bharat Connect claim, no real biller, bill, recharge plan, confirmation or receipt is fabricated. The only configured path will be an environment-gated, clearly labelled **sandbox demonstration provider**; production onboarding prerequisites are documented.

## Financial architecture (non-negotiable)

- Raftline remains authoritative for wallet balances and committed settlements; no second ledger.
- The biller provider is authoritative for biller identity, bill details, amount, due date, payment acceptance, confirmation and reversal/refund status.
- Nexus Pay keeps its **own orchestration records** linking wallet settlement references to provider transaction references; the two are never treated as the same transaction.
- A wallet debit is never presented as biller confirmation or an official biller receipt.
- No blind retry of uncertain settlements; stable idempotency keys; duplicate callbacks deduplicated.
- Existing payment engine, Raftline client and reconciliation flows are reused, not rewritten.

## Implementation plan

1. Provider abstraction + env-gated sandbox + unavailable states.
2. Prisma schema (biller directory, saved accounts, bill fetch/snapshot, payment intents/attempts/history, recharges, receipts, recurring/reminders/autopay, households, webhooks/sync, activity).
3. Services: catalogue, accounts, bill fetch, payment orchestration (two-system state machine + reconciliation), recharges, recurring/reminders, households, receipts, financial-insights adapter, fraud event publisher, Control and worker.
4. Customer APIs/UI and Control Bill Payments Operations.
5. Unit/integration/financial-safety/security/E2E tests, docs, full gates.

## Safety rules

- Estimate ≠ bill; wallet settlement ≠ biller confirmation; Nexus Pay receipt ≠ official biller receipt.
- Explicit customer confirmation before payment; revalidate bill freshness before charging.
- Masks sensitive account identifiers; credentials only in environment/secret management.
