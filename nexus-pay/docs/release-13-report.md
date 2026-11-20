# Release 13 — Fraud Intelligence & Security Platform: Implementation Report

## 1. Implementation summary

Release 13 adds a unified, explainable fraud intelligence platform to Nexus Pay: a structured security event pipeline with a transactional outbox, a rule-based risk engine with versioned configurable policies, transparent behavioral analytics, a read-only payment risk gateway, account/session/device security, contextual scam warnings, investigation cases, customer fraud reports, an advisory ML foundation, privacy-preserving relationship analysis, and a Nexus Control Fraud Intelligence Centre. No fabricated fraud incidents, detections or statistics are displayed. No automated fund freezing or permanent blocking from a model output.

## 2. Existing modules reused

- API conventions (`ApiError`, `jsonOk`, `assertMutationRequest`, `enforceRateLimitOrThrow`, `readJsonBody`).
- Auth/session (`getAuthenticatedUser`, `authenticateCustomer`, `SESSION_COOKIE`, password reauthentication).
- Transactional outbox and two-phase durable worker patterns from merchant webhooks.
- Durable atomic claim/lease/backoff/dead-letter pattern from accounts/credit/insurance sync services.
- Worker bootstrap via global flags in `instrumentation.ts`.
- Notification fan-out (`createNotification`), Control RBAC/audit (`requireControl`, `recordAdminAudit`), AES-256-GCM encryption and signed short-lived download links from document services.
- Raftline balances read from the authoritative client; no local balance mutation.

## 3. New database models and migrations

Migrations: `20261120030630_release13_fraud_intelligence`, `20261120031022_release13_outbox_processing`, `20261120032907_release13_sensitive_action_events`.

26 new models: `SecurityEvent`, `SecurityEventOutbox`, `DeviceRecord`, `UserSessionRisk`, `TrustedDevice`, `RiskEvaluation`, `FraudRiskSignal`, `FraudRule`, `FraudRuleVersion`, `FraudRuleExecution`, `RiskPolicy`, `BehavioralBaseline`, `RiskAlert`, `FraudCase`, `FraudCaseEvidence`, `FraudCaseNote`, `FraudCaseAssignment`, `CustomerFraudReport`, `CustomerFraudReportDocument`, `TransactionRiskAssessment`, `SecurityNotification`, `RiskFeatureSnapshot`, `FraudModelVersion`, `FraudModelEvaluation`, `SecurityAuditEvent`, `SecurityRelationship`. Also extended `NotificationType` and `AdminRole` with fraud roles. Existing session/transaction/audit tables were not duplicated.

## 4. New APIs

Customer: `/api/security/overview`, `/activity`, `/sessions` (DELETE by id, POST revoke-others), `/devices` (PATCH/DELETE by id), `/verify-sensitive-action`, `/reports` (GET/POST), `/reports/:id`, `/reports/:id/documents`, `/reports/:id/history`, `/report-documents/:id/download`, `/safety-guides`, `/warnings`, `/warnings/:id/acknowledge`.

Control: `/api/control/fraud/overview`, `/events`, `/alerts`, `/alerts/:id`, `/alerts/:id/acknowledge`, `/alerts/:id/case`, `/cases`, `/cases/:id`, `/cases/:id/assign`, `/notes`, `/escalate`, `/resolve`, `/rules` (GET/POST/PATCH), `/rules/:id/versions`, `/risk-policies` (GET/PATCH), `/models`, `/audit`, `/run`.

Payment route integration: `POST /api/payments/send` now performs a read-only pre-transaction evaluation before creating a single payment intent.

## 5. Risk engine architecture

Pure functions compute a bounded 0–100 score from matched rule contributions. `RISK_CLASSIFICATIONS` thresholds are configurable in `RiskPolicy` (defaults LOW 0–24, MODERATE 25–49, HIGH 50–74, CRITICAL 75–100). Each evaluation records triggered rules, contributing signals, explanation, evidence quality, ruleset/policy/model versions and a reference. Modes: synchronous pre-transaction, asynchronous post-transaction, periodic account reassessment, manual. Fourteen per-classification actions are configurable; explicit fallback when the engine is disabled or fails, always audited. No black-box decisions.

## 6. Fraud rules implemented

22 deterministic, versioned rules across authentication (failed-login velocity, password-reset velocity, new-device sign-in, MFA-failure velocity which is never emitted while MFA is absent, recovery-then-sensitive), payments (amount deviation, rapid transfers, multiple recipients, failed attempts, unusual hour, post-recovery, similar pattern), merchant (volume spike, refund pattern, webhook config change), rewards (referral/redemption velocity, shared technical indicators), applications (document failure, application velocity, provider failure, duplicate) and behavioral (dormant reactivation). Every rule has an ID, description, category, severity, conditions, thresholds, window, enabled flag, version, contribution, recommended action and audited configuration.

## 7. Behavioral analytics implemented

Transparent rolling mean, mean-absolute-deviation and exponential moving average with a 5-sample cold-start minimum. New customers are never treated as suspicious merely for lacking history; amount-deviation rules explicitly return no match during cold start. Baselines are versioned by metric and stored per user.

## 8. Payment gateway integration details

`lib/fraud/payment-gateway.ts` builds context from hashed recent security events and the user's behavioral baseline, calls the risk engine, and writes a `TransactionRiskAssessment` linked to the original client request. The existing `/api/payments/send` route calls it before `getOrCreatePaymentIntent`; blocking actions return a customer-safe explanation and no payment intent is created. The gateway never writes a wallet, never creates a second payment intent, never changes an idempotency key and never calls Raftline. Unknown settlements remain unknown; reconciliation is untouched. A committed settlement only produces a post-transaction assessment and, where warranted, an investigation case — never a false reversal claim.

## 9. Customer-facing security features

Security overview, event activity timeline, active sessions with remote revocation, trusted-device management, sensitive-action reauthentication (extension point — MFA is not implemented), contextual warnings with acknowledgement, fraud reporting with encrypted document uploads and signed links, and a scam education centre covering social engineering, impersonation, fake support, remote access, fake screenshots, QR manipulation, investment/loan/insurance scams, OTP/PIN theft and refund scams.

## 10. Nexus Control additions

Fraud Intelligence section with overview metrics, event explorer, alerts, investigation queue and case detail, rules management with version history, risk policies, model monitoring, security audit history, `fraud:read`/`fraud:write` permissions, and new `FRAUD_ADMIN`/`FRAUD_ANALYST` roles. All sensitive actions are audited with justification; confirmed fraud counts are never fabricated.

## 11. Background workers and event processing

`startFraudWorker()` registered in `instrumentation.ts`. It publishes outbox rows into the immutable event store with atomic claims, leases, exponential backoff and dead-letter handling; event IDs are unique and inserts idempotent. Periodic reassessment evaluates users with recent security events from actual event data. Sensitive event metadata is stripped of passwords, OTPs, PINs, tokens, card numbers and similar keys before storage.

## 12. Security safeguards

Strong ownership checks on sessions, devices, reports and documents; masked/limited event views; RBAC and role separation; rate limits; CSRF; internal notes never exposed to customers; shared devices/IPs/referrals treated as investigation signals only, never proof; explicit risk-engine failure policy; append-only audit logs; privacy-preserving IP hashes. Raftline remains authoritative and is never mutated by risk operations.

## 13. Tests executed and results

- `pnpm typecheck` — pass · `pnpm lint` — pass · `pnpm build` — pass.
- `pnpm test:unit` — 105 passed (14 new fraud unit tests).
- `pnpm test:integration` — pass (10 new Release 13 integration tests, including financial-boundary and isolation tests).
- `pnpm test:e2e` — pass against a production build (3 new Release 13 scenarios).

## 14. Environment variables and setup

`NEXUS_FRAUD_ENGINE_ENABLED` (default true), `NEXUS_FRAUD_GATEWAY_ENABLED` (default true), `NEXUS_FRAUD_FALLBACK_ACTION` (default `REQUIRE_CUSTOMER_CONFIRMATION`), `NEXUS_FRAUD_RETENTION_DAYS` (default 365). Added to `.env.example` and documented in `docs/environment-setup.md`.

## 15. Known limitations and unfinished work

- MFA is not implemented; sensitive operations use password reauthentication and a documented extension point.
- No trained ML model is deployed; the only model is an advisory rules baseline with no accuracy claims.
- Device identity relies on a client-provided ID (no browser fingerprinting).
- No automated reversal, freezing or blocking; dispute outcomes remain with verified existing processes.
- Relationship analysis uses indexed PostgreSQL tables, not a graph database.

## 16. Confirmation

Releases 1–12 were not rewritten. Changes are additive: new services, models, routes, UI, enum values, permissions, worker registration and one narrow read-only gate inserted into the existing payment route. All Release 1–12 test suites still pass.
