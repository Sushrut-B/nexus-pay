# Nexus Pay Release 1 Test Report

Verification date: 17 November 2026

## 1. Verdict

Release 1 passes its planned automated verification:

- Unit tests: 23 passed.
- Live Raftline integration tests: 2 passed.
- Playwright customer journey: 2 passed.
- TypeScript typecheck: passed for all six packages.
- Production build: passed.
- ESLint: passed with no warnings or errors.
- Prisma migration status: up to date.

The complete customer journey now runs from registration through wallet
provisioning, profile update, sign-out, sign-in and password reset, with test
data removed afterward.

This report covers the implemented Release 1 scope only. Money movement and
verification features remain explicitly out of scope.

## 2. Test environment

| Item | Value |
| --- | --- |
| Operating system | Windows, PowerShell 5.1 |
| Node.js | `24.13.0` |
| pnpm | `11.8.0` |
| Java | `22.0.1` |
| PostgreSQL | `16-alpine`, container `nexuspay-postgres`, healthy |
| Database | `nexus_pay` on host port `5433` |
| Raftline | Five nodes reachable on HTTP `8001`-`8005` |
| Raftline leader at verification | `node-2`, term `733` |
| Web server | Next.js `15.5.29` dev server launched by Playwright |
| Browser | Playwright Chromium, Desktop Chrome profile |
| Mailpit | Container running on `1025` and `8025` |

The Mailpit container is currently an older Mailhog image in the local Docker
environment. The Compose definition now requests Mailpit for future recreations.
Automated tests use the development reset link and do not depend on mail delivery.

## 3. Commands and results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm lint` | Pass | No warnings. `next lint` reports its future deprecation. |
| `pnpm typecheck` | Pass | Database, API client, shared types, UI, validation and web. |
| `pnpm test` | Pass | 23 of 23 tests in 2 files. |
| `pnpm test:integration` | Pass | 2 of 2 live Raftline tests. |
| `pnpm test:e2e` | Pass | 2 of 2 Chromium tests in 2.2 minutes. |
| `pnpm build` | Pass | Optimization, lint and type validation completed. |
| `prisma migrate status` | Pass | One migration; schema up to date. |

## 4. Unit tests

### Validation: 15 tests

Covered:

- Email normalization and invalid email rejection.
- Username length, character and normalization rules.
- Indian mobile normalization to E.164.
- International E.164 acceptance.
- Password complexity and length.
- Registration password confirmation.
- Login input.
- Forgot-password input.
- Reset-password confirmation.
- Onboarding display name, currency and language.
- Profile update fields.
- Unsupported currency and language rejection.

### Raftline API client: 8 tests

Covered:

- Available balance calculation when Raftline omits it.
- Malformed account payload rejection.
- Leader discovery by reported `leaderId` when no probe sees `LEADER`.
- Unavailable cluster handling.
- Official create that silently drops the account, followed by a KV fallback.
- Unique KV client ID and sequence header.
- Existing account adoption without a write.
- Official-only mode failing without KV fallback.
- Currency mismatch rejection.

Total unit tests: 23 passed.

## 5. Live integration tests

The integration suite runs against the actual five-node Raftline cluster and
tenant `nexuspay-test`.

Verified:

1. Current leader discovery.
2. At least one reachable cluster status.
3. Account provisioning with INR currency.
4. Account ID and tenant validation.
5. Zero available balance for a new account.
6. Read-back through the payments account API.
7. A second `ensureAccount` call reports `existing`, not `created`.
8. A missing account returns `null`.
9. Cleanup deletes the test account through the current leader's KV endpoint.

Result: 2 passed.

## 6. End-to-end customer journey

The Playwright test runs serially with one worker against a real Next.js dev
server, PostgreSQL and Raftline.

### Protected route test

1. Visit `/home` without a session.
2. Confirm redirect to `/login`.
3. Confirm the sign-in heading renders.

Result: passed in 5.9 seconds.

### Full customer journey

Verified:

1. Register with name, unique email, Indian mobile, username and password.
2. Redirect to onboarding after registration.
3. Set display name, INR wallet and `en-IN` language.
4. Redirect to the dashboard.
5. Auto-provision the wallet.
6. Observe `Active`.
7. Observe `₹0.00` read from Raftline.
8. Confirm no verification or needs-attention state.
9. Open the profile and update the display name.
10. Confirm the profile success message and updated name.
11. Sign out and return to the public site.
12. Sign in with the original password.
13. Observe active wallet and zero balance.
14. Sign out again.
15. Request a password reset.
16. Follow the development reset link.
17. Choose a new password.
18. Confirm redirect to the login page with reset success.
19. Sign in with the new password.
20. Observe active wallet and zero balance.

Result: passed in 1.8 minutes.

### Cleanup

Global teardown matched local E2E users and deleted:

- 1 test user.
- Related audit and wallet records through database cascades.
- 1 corresponding Raftline ledger account.

Confirmed output:

```text
E2E cleanup: removed 1 test user(s) and 1 ledger account(s).
```

Teardown now derives deterministic account IDs even if a wallet never reached
`ACTIVE`, reducing the chance of orphaned test ledger records.

## 7. Build verification

- Next.js compiled successfully.
- Lint and type checking ran during the build.
- 12 static pages generated.
- All application, API and middleware route entries compiled.
- Dashboard first-load JavaScript was 154 kB.
- Middleware bundle was 34.1 kB.

No production server was started as part of this verification.

## 8. Prisma and database verification

- Prisma schema loaded from `packages/database/prisma/schema.prisma`.
- Datasource resolved to `nexus_pay` on `localhost:5433`.
- One migration found in `prisma/migrations`.
- Migration `20261117034837_init` is applied.
- Database schema is up to date.
- Domain check constraints are present in the migration.
- The E2E flow exercised user, profile, session, wallet, reset-token and audit
  tables.
- Foreign-key cascades removed the local test graph during teardown.

## 9. Raftline verification

All five nodes reported the same term and leader:

| Node | Role | Term | Leader |
| --- | --- | --- | --- |
| `node-1` | `FOLLOWER` | 733 | `node-2` |
| `node-2` | `LEADER` | 733 | `node-2` |
| `node-3` | `FOLLOWER` | 733 | `node-2` |
| `node-4` | `FOLLOWER` | 733 | `node-2` |
| `node-5` | `FOLLOWER` | 733 | `node-2` |

Verified behavior:

- Leader discovery is runtime-based, not hard-coded.
- Existing accounts are read before creation.
- New accounts are verified by read-back.
- The official create defect is handled by controlled KV fallback only after a
  confirmed absent account.
- Ambiguous writes are not retried blindly.
- Account cleanup uses the current leader.
- Available balance is read from Raftline, not PostgreSQL.

## 10. Security verification

| Control | Status | Evidence |
| --- | --- | --- |
| Argon2id password hashing | Implemented | Code review of `lib/security/passwords.ts`. |
| Opaque server-side sessions | Implemented and exercised | Login and protected-route E2E. |
| Session token hashing | Implemented | Code review; only HMAC hashes stored. |
| CSRF token on mutations | Implemented and exercised | Registration, onboarding, profile, logout and reset succeed through the browser. |
| Same-origin checks | Implemented | Code review of `assertMutationRequest`. |
| HTTP-only SameSite cookie | Implemented | Code review of session cookie settings. |
| Protected-route redirect | Verified | E2E protected-route test. |
| Password reset single use | Implemented and exercised | E2E reset followed by new-password login. |
| Reset revokes sessions | Implemented | Code review; transaction revokes all active sessions. |
| Rate limiting | Implemented, not load-tested | Code review; fixed windows are process-local. |
| Request ID propagation | Implemented | Code review of API response helper. |
| Security headers | Implemented | Code review of `next.config.mjs`. |
| Balance not stored locally | Verified | Schema review and E2E balance read from Raftline. |
| Sensitive detail redaction | Implemented | Code review of API error mapping. |

The test suite does not independently assert rejected CSRF requests, rate-limit
lockouts, cookie flags from the browser, or security headers at the HTTP
boundary. These are implementation-reviewed controls and should receive dedicated
negative tests before production.

## 11. Defects found and resolved during verification

1. **Invalid E2E full name**
   - The original test used `E2E Tester`.
   - The validation rule rejects digits in names.
   - Fixed the fixture to `Nexus Tester` and `Nexus Profile`.

2. **Playwright teardown could not resolve `@nexus/database`**
   - Playwright's teardown loader could not resolve the workspace package.
   - Changed the teardown to import the workspace source by relative path.

3. **E2E runtime close to its timeout**
   - The full journey took about 1.9 minutes.
   - Increased Playwright's test timeout to 180 seconds.

4. **Active wallet with a missing ledger account had a no-op recovery button**
   - The UI offered reconciliation, but the provision service returned early for
     every active wallet.
   - The service now detects `ACCOUNT_NOT_FOUND`, moves the wallet to
     `RECONCILIATION_REQUIRED`, records an audit event and reclaims it for
     verification.
   - This path compiled and built successfully but is not covered by an automated
     test in Release 1.

5. **Teardown skipped never-activated wallets**
   - Cleanup only considered stored `raftlineAccountId` values.
   - Teardown now derives the deterministic account ID for every E2E wallet.

6. **Fresh Docker volumes used the wrong database name**
   - Compose originally created `nexuspay`, while the application uses
     `nexus_pay`.
   - Compose now creates `nexus_pay` for fresh volumes.
   - The existing local volume already contained `nexus_pay`; the setup guide
     documents how to create it if missing.

7. **Environment template pointed to the wrong file**
   - The template said to copy `.env` at the repository root.
   - Next.js reads `apps/web/.env.local`, and Prisma reads
     `packages/database/.env`.
   - The template and setup documentation now state both paths and canonical
     environment names.

## 12. Requirements coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| Customer registration | Verified | E2E. |
| Secure password storage | Implemented | Argon2id review. |
| Login and logout | Verified | E2E. |
| Protected customer routes | Verified | E2E redirect. |
| Onboarding and preferences | Verified | E2E. |
| Wallet provisioning | Verified | E2E and integration. |
| Verified active state | Verified | E2E waits for `Active`. |
| Authoritative balance read | Verified | E2E shows `₹0.00` from Raftline. |
| Explicit wallet failure states | Implemented | State model, retry UI and reconciliation tests at adapter level. |
| Profile update | Verified | E2E. |
| Password reset | Verified | E2E. |
| Audit trail | Implemented and exercised | Registration through E2E, then cleanup. |
| Responsive UI | Implemented | Build and browser journey; no automated viewport matrix. |
| Error and recovery UX | Implemented | Code review; only normal journey is E2E-tested. |
| Architecture and setup documentation | Complete | `docs/`. |

## 13. Not verified or not covered

- Real email delivery through SMTP and Mailpit.
- Email and phone ownership verification; not implemented in Release 1.
- Negative CSRF, rate-limit and security-header tests.
- Active-wallet reconciliation automated regression test.
- Concurrent provisioning from multiple application instances.
- Raftline leader failover during an in-flight provisioning request.
- Chaos, load, soak or performance testing.
- Browser matrix beyond Chromium Desktop Chrome.
- Accessibility audit with assistive technology.
- Production deployment, observability and backup restoration.
- CI pipeline and branch protection.
- Financial operations, since payments are out of scope.

## 14. Residual risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Raftline official create can silently drop | Wallet could fail or need reconciliation | Read-before-write, read-back, one attempt, confirmed-absence fallback, explicit state. |
| Direct KV fallback bypasses part of the payment manager path | Compatibility risk | Tenant-scoped key, read-back verification, controlled modes and documentation. |
| In-memory rate limits | Bypass across instances | Single-instance assumption; use shared store before scaling. |
| Local and ledger writes are not atomic | Orphan account or mapping possible | Deterministic account ID, state machine, audit trails and reconciliation. |
| No email verification | Unverified customer email | Explicitly deferred; do not treat email as verified. |
| No CI | Regressions can merge unnoticed | Run documented commands locally; add CI before production. |
| `next lint` deprecation | Future build break | Migrate to ESLint CLI before Next.js 16. |
| No active-wallet reconciliation test | Recovery path could regress | Add a targeted test with a missing ledger account. |

## 15. Reproduction

From `C:\Sushrut\projects\nexus-pay`, with Raftline and PostgreSQL running:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

Or run the primary checks together:

```powershell
pnpm lint
if ($?) { pnpm typecheck }
if ($?) { pnpm test }
if ($?) { pnpm test:integration }
if ($?) { pnpm build }
if ($?) { pnpm test:e2e }
```

E2E requires a configured `apps/web/.env.local` and a migrated database. See
`docs/environment-setup.md` for prerequisites and cleanup behavior.

## 16. Final assessment

Nexus Pay Release 1 is internally consistent and passes the full planned
browser, live-ledger, unit, type, lint and build verification. The implementation
has explicit financial failure handling and avoids the common anti-pattern of
shadowing the ledger balance in PostgreSQL.

Production readiness still depends on negative security tests, active-wallet
recovery coverage, a shared rate-limit store, email verification, observability,
backup/restore validation, CI and the Raftline create-defect resolution.
