# Release 20 — Account Security, Privacy & Identity Protection — Delivery Report

## Implemented features
- Security overview with factual indicators (last login, active sessions, trusted devices, auth methods, recent events, unread security notifications) and no security score.
- TOTP MFA (RFC 6238 via `otplib`): step-up-gated enrollment, encrypted secret, one-time display, live-code confirmation, 10 hashed recovery codes shown once, regeneration, strong-reauth disable.
- Login MFA: first factor issues a short-lived hashed challenge instead of a session; verification exchanges a TOTP/recovery code for a session.
- Persisted single-use step-up grants bound to `(user, session, action)`; enforced by password change and MFA management routes.
- Password change with current password or step-up, Argon2id policy, session revocation.
- Account recovery: generic responses, hashed single-use TTL tokens, password reset, all-session revocation, notifications, admin review.
- Privacy Centre: versioned consent history with purpose/version/source/timestamp, withdrawal that stops external-account processing where supported, required purposes protected, retention explanation.
- Data export: durable job, owner-only JSON package, encrypted at rest, 5-minute HMAC signed links, expiry.
- Data deletion: reviewable request lifecycle with explicit confirmation; no financial/ledger data deleted.
- Nexus Control Security Operations: event search, incidents, recovery/deletion review, audited session revocation, least-privilege roles.
- Durable security worker for export generation, cleanup and operational snapshots.

## Migrations and configuration
`20261121060000_release20_account_security` (applied): adds `SECURITY_ADMIN`/`SECURITY_ANALYST` admin roles, 14 security event types, 6 notification types, and 13 tables (`auth_methods`, `recovery_codes`, `mfa_challenges`, `step_up_grants`, `account_recovery_requests`, `privacy_consents`, `privacy_consent_events`, `data_export_requests`, `data_deletion_requests`, `security_notification_events`, `security_jobs`, `admin_security_actions`, `security_incidents`). No wallet/ledger/payment table changed.

New dependencies: `otplib@12.0.1` (apps/web + root devDependency). New env flags: `NEXUS_SECURITY_ENABLED`, `NEXUS_SECURITY_MFA_ENABLED`, `NEXUS_SECURITY_MFA_CHALLENGE_TTL_MINUTES`, `NEXUS_SECURITY_STEP_UP_TTL_MINUTES`, `NEXUS_SECURITY_RECOVERY_TTL_MINUTES`, `NEXUS_SECURITY_EXPORT_TTL_HOURS`.

## New / changed APIs
- `POST /api/auth/mfa/verify` (login factor two, TOTP or recovery code, rate-limited).
- `GET /api/security/overview`, `GET /api/security/methods`.
- `POST /api/security/step-up`, `POST /api/security/change-password`.
- `POST /api/security/mfa/enroll|confirm|disable|recovery-codes`.
- `POST /api/security/recovery/request|complete`, `GET /api/security/recovery/requests`.
- `GET/POST /api/security/privacy/consents`.
- `GET/POST /api/security/exports`; `POST /api/security/exports/[id]/link`; `GET /api/security/exports/[id]/download`.
- `GET/POST /api/security/deletions`.
- Control: `GET /api/control/security/overview`; `POST /api/control/security/sessions/[id]/revoke`, `sessions/revoke-all`, `incidents`, `incidents/[id]/resolve`, `recovery/[id]/review`, `deletions/[id]/review`.
- Changed: `authenticateCustomer` returns an MFA challenge instead of a session when TOTP is active; login route returns challenge fields.

## Security and privacy decisions
See `docs/release-20-threat-model.md`. Secrets are never logged or stored in plaintext; internal-only data is never exposed to customers; support/security never override authoritative financial state; no identity verification or provider delivery is claimed.

## Tests
`pnpm typecheck` ✅ (6/6), `pnpm lint` ✅, `pnpm test:unit` 173/173 ✅,
R20 integration 9/9 ✅, full integration 214/214 ✅ (212 on the first run; two
unrelated R13/R4 tests hit a transient Raftline fetch failure and a timing flake,
then passed 17/17 on isolated rerun with no code changes), `pnpm build` ✅
(205+ pages including all R20 routes), `pnpm test:e2e` 44/44 ✅ (including the
3 new R20 specs).

## Unavailable / follow-up
Passkeys/WebAuthn (no verifier dependency); distributed rate limiting; SMTP delivery must be configured in production; no KYC; expired export file deletion is a follow-up; no claim that deletion or provider action completed without verified completion.

Release 21 was not started.
