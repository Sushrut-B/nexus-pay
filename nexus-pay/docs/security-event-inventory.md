# Release 13 — Verified Security Event Inventory (Phase 0)

Verified against commit `3586386`. "Available" means the module exists and a concrete state transition was inspected. No event is published from a module that does not exist.

## Event catalogue and verified sources

### Authentication (available — `apps/web/lib/auth/service.ts`, `app/api/auth/*`, `lib/auth/session.ts`)

| Event | Source | Fields available now |
| --- | --- | --- |
| LOGIN_SUCCESS | `authenticateCustomer` / `auth/login/route.ts` | actor, ipAddress, userAgent, requestId |
| LOGIN_FAILURE | `authenticateCustomer` (failure path), login route rate-limit | ipAddress, userAgent, requestId; actor may be unresolved |
| LOGOUT | `auth/logout/route.ts` → `revokeCurrentSession()` | actor, sessionId |
| PASSWORD_RESET_REQUESTED | `auth/forgot-password/route.ts` | ipAddress, userAgent, requestId |
| PASSWORD_RESET_COMPLETED | `auth/reset-password/route.ts` | actor, requestId; revokes all sessions |
| PASSWORD_CHANGED | reset-password / profile password flow | actor, requestId |
| SESSION_CREATED | `createSession()` (`lib/auth/session.ts`) | actor, sessionId, ipAddress, userAgent |
| SESSION_REVOKED | `revokeCurrentSession()` / `revokeAllSessions()` | actor, sessionId |
| NEW_DEVICE_LOGIN | login route vs stored `UserSession.userAgent`/`ipAddress` | actor, ipAddress, userAgent, sessionId |
| MFA_ENABLED / MFA_FAILED | **NOT AVAILABLE** — MFA is not implemented anywhere. Event types are declared for forward compatibility but never published. Step-up uses password reauthentication. | — |

### Account (available — `auth/*`, `wallet/service.ts`, `profile` routes)

PROFILE_CHANGED, EMAIL_CHANGED, PHONE_CHANGED, RECOVERY_DETAILS_CHANGED (profile service), WALLET_CREATED (`provisionWallet`), ACCOUNT_RECOVERY_REQUESTED (password reset).

### Payment (available — `lib/payments/payment-service.ts`, `app/api/payments/send/route.ts`)

| Event | Existing decision point | Notes |
| --- | --- | --- |
| PAYMENT_INITIATED | `getOrCreatePaymentIntent` audit `PAYMENT_INTENT_CREATED` (L142) | idempotency `(userId, clientRequestId)`; ledger key `np_pay_<uuid>` created once |
| PAYMENT_PROCESSING | `executePaymentIntent` claim (L198) | attemptCount incremented atomically |
| PAYMENT_SETTLED | `finalizeSettled` (L423/527) | verified Raftline receipt only |
| PAYMENT_REJECTED | `finalizeRejected` (L543/579) | verified rejection only |
| PAYMENT_UNKNOWN | `markUnresolved` / `UNKNOWN` status (L653) | mapped explicitly; never a confirmed failure |
| PAYMENT_RECONCILIATION_REQUIRED | `reconcilePaymentIntent` | existing reconciliation preserved |
| PAYMENT_REVIEWED / PAYMENT_CANCELLED | review/cancel paths where present | — |

Raftline remains authoritative; balances are read via `buildWalletOverview → getRaftlineClient().getAccount`; no local balance mutation.

### Module events available for publication

- **Merchant** (`lib/merchant/*`): MERCHANT_REGISTERED, MERCHANT_SETTINGS_CHANGED, PAYMENT_LINK_CREATED, CHECKOUT_PAYMENT_INITIATED, REFUND_REQUESTED, WEBHOOK_CONFIGURATION_CHANGED.
- **Rewards** (`lib/rewards/*`): REWARD_EARNED, REWARD_REDEEMED, REFERRAL_CREATED, REFERRAL_REWARDED, CASHBACK_ISSUED.
- **Credit** (`lib/credit/*`): LOAN_APPLICATION_SUBMITTED, PROVIDER_WEBHOOK_RECEIVED.
- **Insurance** (`lib/insurance/*`): INSURANCE_QUOTE_REQUESTED, INSURANCE_APPLICATION_SUBMITTED, DOCUMENT_UPLOADED, PROVIDER_WEBHOOK_RECEIVED.
- **Subscriptions** (`lib/subscription/*`): billing transitions via `transitionStatus` / `processBillingOccurrence`.
- **Social** (`lib/social/*`): payment requests, group settlements.
- **External accounts** (`lib/accounts/*`): connection consent/revocation and sync.

## Context available without new middleware

`getClientIp(request)` (IP), `request.headers.get("user-agent")`, `getAuthenticatedUser().sessionId`, `getRequestId(request)`. No device identifier exists; Release 13 introduces a **client-generated, user-controllable** device id (not browser fingerprinting). IP is stored as a privacy-preserving hash in security events.

## Reusable infrastructure

- Transactional outbox: `lib/merchant/payment-service.ts` + `lib/merchant/webhook-service.ts` (two-phase PENDING→DISPATCHED→delivery, lease, backoff, dead-letter).
- Durable claim/lease/retry/dead-letter: `lib/accounts/sync-service.ts` (`LEASE_MS=300_000`, `MAX_ATTEMPTS=3`).
- Worker bootstrap: `instrumentation.ts` + `*worker-bootstrap.ts` global flags.
- API: `ApiError`/`jsonOk`, `assertMutationRequest`, `enforceRateLimitOrThrow`, `readJsonBody`.
- Control: `requireControl`, `withRequest`, `recordAdminAudit`, `PERMISSIONS`, `control-shell.tsx` NAV, `components/control/ui.tsx`.
- Audit sinks: `recordAudit` (customer), `dataAccessAuditEvent`, `recordAdminAudit`.
- Notification sink: `createNotification` (`lib/social/shared.ts`).

## Honest gaps

No generic SecurityEvent/Risk/Fraud table existed. No MFA. No device id. No `PAYMENT_INITIATED`/`PAYMENT_UNKNOWN` audit action strings. Release 13 adds all of these as new, additive structures; it does not claim they existed before.
