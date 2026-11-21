# Release 20 — Threat Model (Account Security, Privacy & Identity Protection)

## Assets
- Account credentials: Argon2id password hashes (never plaintext).
- TOTP secrets (AES-256-GCM encrypted at rest), recovery codes / reset / recovery /
  MFA challenge / step-up tokens (HMAC-SHA256 hashes only, never plaintext).
- Session cookies (`np_session`) and CSRF cookie (`np_csrf`).
- Security events, audit trails, consent history, export packages.

## Trust boundaries
1. Browser → Nexus Pay API: CSRF token + SameSite=Lax + origin check on all mutations.
2. Unauthenticated → authenticated: password first factor; optional TOTP second factor.
3. Customer → Nexus Control: separate `np_control_session` and least-privilege `security:*` permissions.
4. Application → Raftline: unchanged; support/security layers never write authoritative balances.

## Threats & mitigations

| Threat | Mitigation |
|---|---|
| Account enumeration | Generic login/recovery messages; dummy Argon2 hash for unknown accounts; per-IP and per-identifier rate limits. |
| Credential stuffing / brute force | `login-ip` 20/5 min, `login-account` 8/5 min, password policy (10–128 chars, mixed classes, Argon2id m=19456,t=2,p=1). |
| Session theft / fixation | 32-byte opaque token, HMAC-hash stored, HttpOnly/Secure(prod)/SameSite=Lax cookie, new token on every sign-in, revoke on password change/recovery. |
| IDOR on sessions / exports / requests | Server-side ownership checks on every operation (`userId` from authenticated session, never from body); returns 404 for foreign records. |
| MFA bypass | First factor produces a short-lived single-use hashed challenge, not a session; verification consumes challenge atomically; enrollment requires a valid TOTP code and step-up; disabling requires step-up + password. |
| TOTP secret leakage | Encrypted at rest; returned in API response only during enrollment; never logged; no secret in notifications/events/audit. |
| Recovery-code replay / theft | 10 codes, HMAC-hashed, shown once, marked used in a conditional transaction; regeneration invalidates unused codes. |
| Reset/recovery token replay | Hashed storage, TTL, conditional single-use consume, prior unused tokens invalidated, sessions revoked on completion. |
| Step-up grant replay | Persisted hashed grant bound to `(userId, sessionId, action)`, short TTL, conditional single-use consume. |
| Notification flooding / secret leakage | `eventKey` unique dedupe; bodies contain no passwords, codes, tokens or full account details; per-module rate limits. |
| Malicious privileged operator | `SECURITY_ANALYST`/`SECURITY_ADMIN` least-privilege scopes, reason required for sensitive actions, `AdminSecurityAction` + `SecurityAuditEvent` audit, no "log in as customer", no balance edits. |
| Export data leakage | Durable job, owner-only access, encrypted file at rest, 5-minute HMAC signed links with constant-time verification, expiring packages, no contents in logs. |
| Overclaiming deletion | Deletion requests are reviewable lifecycles; no Raftline/financial record erased; retention notice states backups/third parties are not immediately purged. |
| Invasive device tracking | No fingerprinting; device id comes from an explicit `x-device-id` request header; IP/UA stored hashed in security events; device labels marked approximate. |

## Known gaps / follow-up
- Passkeys/WebAuthn are not implemented (no verifier dependency); the method type exists but is explicitly unavailable.
- Rate limiting is in-process (`FixedWindowRateLimiter`), not distributed; deploy a shared limiter for multi-instance production.
- SMTP delivery is optional; without `SMTP_HOST`, no email is sent (dev mode may return recovery tokens). Production requires configured mail.
- No identity verification/KYC is performed; `isEmailVerified`/`isPhoneVerified` remain unused.
- Expired export files are marked `EXPIRED` by the cleanup job but file deletion is follow-up work.
