# Release 20 — Assessment & Implementation Plan

## Baseline (verified)
Releases 1–19 are present and green: typecheck (6/6), lint, unit 169/169.
Git tree clean at `a889466`. No Release 20 code existed.

## Audit findings (source-verified)

### Reuse (do not duplicate)
- **Auth/session**: `lib/auth/session.ts` (`np_session`, HMAC-hashed tokens,
  `createSession`, `getAuthenticatedUser`, revoke single/all), `lib/security/tokens.ts`
  (`generateOpaqueToken`, `hashToken`, `safeEqual`), `lib/security/passwords.ts`
  (Argon2id + dummy hash), `UserSession` (`sessionTokenHash`, `revokedAt`,
  `lastUsedAt`), CSRF `np_csrf`, rate limiter, Argon2 password policy.
- **Password reset**: hashed single-use `PasswordResetToken` with 30-min TTL,
  generic response, session revocation on completion. SMTP is opt-in
  (`SMTP_HOST`); dev mode returns the link in the API body. No email SaaS.
- **Security events**: `publishSecurityEvent` + outbox worker + `securityAudit`,
  `/api/security/activity` customer history, `/api/control/fraud/events` admin view.
- **Devices/sessions UI**: `DeviceRecord`, `TrustedDevice`, `UserSessionRisk`,
  `lib/fraud/device-service.ts` (`listDevices`, `listSessions`, `setDeviceTrust`,
  `revokeOtherSessions`), `x-device-id` from client (not fingerprinting).
- **Privacy**: domain-specific consents only (external accounts, investments,
  insurance, loans) with real revocation that blocks provider calls.
  `/api/privacy/*` only aggregates external consents; deletion requests are
  audit-log entries with a hardcoded `RECORDED` status — no real workflow/export.
- **Exports**: `report-service.ts` durable claim/lease/dead-letter export job and
  5-minute HMAC signed links (`support/evidence-service.ts`) are the templates.
- **Control RBAC**: `AdminRole`, `PERMISSIONS`, `requireControl`, `recordAdminAudit`,
  `control-shell` NAV, `control/ui.tsx`. No security-operations page exists.
- **Notifications**: `createNotification`; per-domain preference + `eventKey`
  dedupe pattern from `lib/support/support-audit.ts`.

### Genuinely missing
- **MFA/TOTP/WebAuthn**: no implementation, no library, no models. Declared-only
  `MFA_ENABLED`/`MFA_FAILED` events. `qrcode` exists (payment QR), no OTP lib.
  → Added standard `otplib@12.0.1` (RFC 6238 TOTP, SHA-1, 6 digits, 30 s).
- **Passkeys/WebAuthn**: no library; implementation deferred and documented.
- **Step-up enforcement**: `verify-sensitive-action` issues an unpersisted token
  that nothing checks; no change-email/phone/password routes to gate.
- **Generic privacy consent/purpose/version model**, real export/deletion
  workflows with statuses, security-operations Control role/page.
- **Identity verification/KYC**: none; `isEmailVerified`/`isPhoneVerified` fields
  are dead data. Do not claim identity verification.

## Decisions
1. Build a separate `lib/identity/**` module; reuse auth/session/security-event/
   device/notification/worker infrastructure instead of replacing it.
2. TOTP enrollment: require recent password reauth (step-up), generate secret with
   `otplib`, encrypt with `encryptSecret`, show provisioning URI only once,
   verify a live code + one recovery code before activation. Recovery codes are
   HMAC-hashed (`hashToken`), shown once, single-use.
3. Login: if an active TOTP method exists, first-factor success issues a short-lived,
   hashed, single-use MFA challenge instead of a session; `/api/auth/mfa/verify`
   exchanges a valid TOTP/recovery code for a session. No MFA → unchanged flow.
4. Step-up: persisted, short-lived, consumed `StepUpGrant` checked by sensitive
   routes in this release (change password, MFA changes, recovery settings).
5. Passkeys/WebAuthn: architecture kept extensible (`AuthMethodType.PASSKEY`),
   unavailable with documented dependency (`@simplewebauthn/*`).
6. Privacy: generic versioned consent records + real export/deletion request
   lifecycles with durable jobs and signed links; no deletion of Raftline records.
7. Control: new `SECURITY_ADMIN`/`SECURITY_ANALYST` roles with `security:*`
   permissions, reason-required administrative actions, audit records.
8. No fabricated identity verification, provider delivery, or "fully protected"
   security score. Notifications deduplicated with `eventKey`; no secrets in events.

## Phases
1. Audit (done) → 2. schema/migration → 3. MFA + step-up + login integration →
4. recovery + notifications → 5. privacy + export/deletion → 6. dashboard APIs/UI →
7. Control security operations → 8. durable workers → 9. tests + gates.

Release 21 is out of scope.
