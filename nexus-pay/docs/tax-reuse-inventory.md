# Release 17 — Verified Reusable Source Inventory

Phase 0 audit findings (sources verified in commit `261b1cd`):

- **Canonical aggregation engine:** `lib/finance-intelligence/classification-service.ts` — `loadClassifiedTransactions(userId, from, to, {includeExternal})`, `moneyMovements(records)`. Provenance fields on `ClassifiedRecord`: `sourceType`, `sourceId`, `category`, `direction`, `amountMinor`, `classificationSource`, `paymentRef`, `occurredAt`. Skip sets exclude merchant/bill/travel P2P duplicates, rewards, group settlements and internal transfers. Tax calls this once and never re-sums raw tables.
- **Accounts:** `lib/accounts/accounts-service.ts` — `listAccounts`, `getAccountAnalytics(userId, "ALL")`, `getUnifiedTransactions`; liabilities from credit-card/loan accounts.
- **Investments:** `lib/investments/portfolio-service.ts` (`getPortfolio`, `listInvestmentTransactions`), `wealth-service.ts` (`getNetWorth`, `listFixedIncome`), `planning-service.ts` (`listSips`), `discovery-service.ts` (funds/instruments/prices). All records carry `source`, `providerRef`, `providerReportedAt`, `isSandbox`.
- **Merchant/subscription:** `lib/merchant/payment-service.ts` (`listMerchantPayments`), `lib/finance-intelligence/subscription-intelligence-service.ts`.
- **Credit/insurance/billing:** `lib/credit/loan-service.ts` (`listLoans`, `getRepayments`), `lib/insurance/policy-service.ts` (`listPolicies`, `getPremiums`), `lib/billing/payment-service.ts` (`listPayments`).
- **Documents/export:** AES-256-GCM `lib/security/crypto.ts`; signed-link pattern in `lib/investments/document-service.ts`; PDF/CSV generation in `lib/finance-intelligence/report-service.ts` (`render`, `createReport`, `processReportJob`).
- **Workers/webhooks:** claim/lease/backoff/dead-letter in `lib/investments/sync-service.ts`, `lib/travel/travel-webhook-service.ts`; `instrumentation.ts` registers all workers. No OCR/extraction engine exists.
- **Notifications/events:** `createNotification` in `lib/social/shared.ts`; `publishSecurityEvent` in `lib/fraud/event-service.ts`.
- **Control:** `PERMISSIONS` in `lib/control/auth.ts`, `requireControl` in `api-guard.ts`, NAV in `control-shell.tsx`.

**Honest gaps:** no existing tax/TDS/PAN/Form16 logic; only pass-through `taxMinor` invoice/order fields. No government API, no filing provider, no OCR dependency. These are implemented as new, clearly labelled modules in Release 17.
