# Release 19 — Assessment, Audit Findings & Implementation Plan

This document records the mandatory audit before Release 19 (Customer Support,
Disputes & Resolution Centre). It is based on direct inspection of the Nexus Pay
source at Release 18 (`29d3448`). Release 19 was not assumed to exist.

## 1. Baseline (verified)

Releases 1–18 are genuinely implemented; R18 added Global Finance. Baseline
gates before R19 code: `pnpm typecheck` ✅, `pnpm lint` ✅, `pnpm test:unit`
162/162 ✅. No existing support case engine exists.

## 2. Existing support / dispute / refund functionality (definitive)

There is **no generic support, complaint, ticket, dispute, help-article or
attachment model/service**. The closest domain-specific analogues are:

| Module | Existing capability | Authoritative? |
|---|---|---|
| Merchant refunds | `lib/merchant/refund-service.ts` — `createRefundRequest`, `listRefunds`, `reviewRefund`; `MerchantRefundRequest` (`REQUESTED…SUCCEEDED…UNKNOWN`). Approval note literally says Raftline has no refund/reversal and **no money moved**. | Advisory only |
| Payments | `lib/payments/payment-service.ts`, `verify.ts`, `lib/control/payment-service.ts` — `getPaymentOperation`, `listReconciliationCases`, `investigateReconciliation` (read-only, never resubmit/new key), `resolveReconciliation` (requires verified receipt). Raftline is sole ledger. | Authoritative |
| Bill payments | `BillPaymentIntent` statuses incl. `REFUND_PENDING/REFUNDED`; `BillReconciliationCase`; sandbox biller `refunds:false, complaints:false` with `requestRefundOrReversal`/`getComplaintStatus` returning `null`. No refund execution and no complaint model. | Provider authoritative |
| Travel | `cancelBooking` → `TravelCancellation` + `TravelRefund` (provider-reported `PENDING`), `TravelReconciliationCase`; webhooks confirm bookings, **not** refunds. | Provider authoritative |
| International (R18) | `lib/global/international-payment-service.ts` — transfer states, `reconcileTransfer` (original provider ref, no blind retry), compliance checks, HMAC webhooks. | Provider authoritative |
| Fraud | `lib/fraud/case-service.ts`, `report-service.ts` with encrypted evidence and signed links; risk signals are observer-only, no fund freezing. | Read-only observer |

### Verdict

Release 19 must add a **thin case-management layer** that links to these records
**read-only** and reuses `createNotification`, `publishSecurityEvent`,
`securityAudit` and `recordAdminAudit`. It must not settle payments, execute
refunds/reversals, confirm provider outcomes, edit balances, or reimplement any
domain state machine. No module currently supports a real refund/reversal.

## 3. Reuse inventory (exact patterns)

- **RBAC**: `AdminRole` is a 5-value enum mirrored in `shared-types/control.ts`,
  Prisma `enum AdminRole`, `PERMISSIONS` in `lib/control/auth.ts`, validation
  `z.enum(ADMIN_ROLES)`, and migration. R13 fraud roles are the exact template.
  Add `SUPPORT_AGENT` / `SUPPORT_SUPERVISOR` with least-privilege `support:*`
  permissions; gate routes via `requireControl("support:read"|...)`.
- **Audit**: `recordAdminAudit` in `lib/control/audit.ts` for privileged actions.
- **Encryption/documents**: `lib/security/crypto.ts` `encryptSecret`; 5-minute
  HMAC signed links from `lib/travel/document-service.ts` /
  `lib/fraud/report-service.ts`; AES-encrypted files under `.support-evidence/`.
- **Notifications**: `createNotification(db, {userId,type,title,body,data})`;
  no global preferences, so R19 adds `SupportNotificationPreference` and
  de-duplicates via `SupportNotificationEvent.eventKey`.
- **Workers**: `lib/global/global-worker-bootstrap.ts` — atomic claim, 5-minute
  lease, 3 attempts with backoff, dead-letter, lease recovery, `instrumentation.ts`.
- **Tests**: R18 integration/E2E scaffolding, `createUser`, control sign-in.

## 4. Design decisions

1. **Separate domain module** `apps/web/lib/support/**`; no changes to payment,
   refund, booking, or provider services.
2. **Every linked record is resolved server-side** by ID and ownership-checked
   before it is stored on a case. Client-supplied references are verified, never
   trusted. Linked records expose only a permitted summary plus the authoritative
   status read from the existing service.
3. **Support state is independent of financial state.** Cases have their own
   lifecycle; a case can be RESOLVED while a payment remains UNKNOWN.
4. **Internal-only notes/messages** are stored with `INTERNAL_ONLY` visibility
   and never returned by customer APIs.
5. **Evidence** is AES-256-GCM encrypted at rest with signed short-lived links,
   upload access logs, allowed MIME types and size caps.
6. **Durable jobs only** for notifications, reminders, escalation evaluation,
   help review and analytics; read-only verified-status sync of linked operations.
7. **No fake SLA promises**: timelines show actual timestamps and "no verified
   service target" where no policy exists.

## 5. Implementation phases

1. Audit (this doc) + baseline — **done**
2. Schema + shared types + validation + env + RBAC.
3. Case foundation: lifecycle, events, ownership, messages, internal notes,
   attachments, priority/escalation/resolution.
4. Link service: payment/merchant/bill/travel/investment/tax/international/
   wallet/subscription read-only linkage.
5. Customer Support Centre + guided reporting + Help Centre.
6. Nexus Control support inbox/workspace/analytics + RBAC.
7. Durable workers + notifications.
8. Tests (unit/integration/E2E/security/regression) + full gates.

Release 20 is explicitly out of scope and is not started.
