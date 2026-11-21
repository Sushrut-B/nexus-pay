# Release 19 — Customer Support, Disputes & Resolution Centre — Delivery Report

## 1. Implemented feature summary

Release 19 adds a unified **case-management layer** to Nexus Pay: a Support
Centre dashboard, guided issue reporting with server-verified record linkage,
durable case lifecycle and timeline, case-based messaging with private internal
notes, encrypted evidence with signed short-lived links, priority and documented
escalation, resolution proposals, a versioned Help Centre, idempotent
notifications, Nexus Control support operations and fact-based analytics, and
durable background workers.

It does **not** move money, execute refunds/reversals/cancellations, confirm
provider outcomes, or alter authoritative payment/provider/balance records.
Support status is always separate from financial status. Release 20 was not
started.

## 2. Files created and modified

### New module (`apps/web/lib/support/`)
`support-constants.ts`, `support-audit.ts`, `link-service.ts`, `case-service.ts`,
`evidence-service.ts`, `help-service.ts`, `support-operations.ts`,
`support-worker-bootstrap.ts`.

### Packages / app wiring
- `packages/shared-types/src/support.ts` (new) + barrel; `control.ts` (roles),
  `security.ts` + `social.ts` (new event types).
- `packages/validation/src/index.ts` — Release 19 validation block.
- `apps/web/lib/env.ts`, `.env.example` — R19 flags.
- `apps/web/lib/control/auth.ts` — `SUPPORT_AGENT`/`SUPPORT_SUPERVISOR` roles and
  least-privilege `support:*` permissions.
- `apps/web/instrumentation.ts` — `startSupportWorker()` registration.
- Customer NAV (`/support`), Control NAV (`/control/support`).
- `components/support/support-ui.tsx` (new).
- 6 customer pages under `app/(customer)/support/**` and 5 Control pages under
  `app/control/support/**`.
- 28 API routes (13 customer + 15 Control) under `app/api/support/**` and
  `app/api/control/support/**`.
- New tests: `tests/unit/support-rules.test.ts`,
  `tests/integration/release19-support.test.ts`,
  `tests/e2e/release19-support.spec.ts`.
- Docs: `docs/release-19-assessment.md`, `docs/release-19-report.md`.

## 3. Database migrations

Single additive migration `20261121040000_release19_customer_support`:

- Adds `SUPPORT_AGENT`/`SUPPORT_SUPERVISOR` to `AdminRole`, nine `SUPPORT_*`
  notification types and five `SUPPORT_*` security event types.
- Creates 19 tables: `support_cases`, `support_case_events`, `support_messages`,
  `support_message_attachments`, `support_message_read_states`,
  `support_case_assignments`, `support_priority_history`, `support_escalations`,
  `support_resolutions`, `support_linked_operations`, `support_provider_inquiries`,
  `help_article_categories`, `help_articles`, `help_article_versions`,
  `help_article_feedback`, `support_notification_preferences`,
  `support_notification_events`, `support_jobs`, `support_audit_events`.

No wallet, payment, refund, provider or ledger table was modified. Unique keys
enforce case-reference/idempotency, one feedback per article/user, one inquiry
per case/module/operation, and one linked operation per case/module/reference.

## 4. Case lifecycle and permission model

Statuses: `OPEN → TRIAGED → IN_PROGRESS → WAITING_FOR_USER |
WAITING_FOR_PROVIDER → ESCALATED → RESOLUTION_PROPOSED → RESOLVED → CLOSED`,
with `REOPENED` permitted from RESOLVED/CLOSED. Transitions are validated by
`CASE_TRANSITIONS`; every change appends an auditable `SupportCaseEvent`.
Customer timeline events exclude internal notes and internal-only events.

Permissions (least privilege):
- `SUPPORT_AGENT`: `support:read`, `support:write`, `support:respond`, `audit:read`.
- `SUPPORT_SUPERVISOR`: adds `support:escalate`, `support:resolve`,
  `support:sensitive`.
- `OPERATOR`: `support:read/write/respond/escalate/resolve`; `VIEWER`:
  `support:read`; `SUPER_ADMIN`: all via `*`.
Routes gate with `requireControl("support:read"|"support:write"|
"support:escalate"|"support:resolve")`. Support staff cannot edit balances,
Raftline records, payments or provider status.

## 5. API documentation

Customer (`/api/support/`): `GET/POST cases`, `GET cases/:id`,
`POST cases/:id/messages`, `GET/POST cases/:id/attachments`,
`DELETE attachments/:id`, `POST attachments/:id/link`,
`GET attachments/:id/download`, `POST cases/:id/reopen`,
`GET categories`, `GET articles`, `GET articles/:id`,
`POST articles/:id/feedback`, `GET/PUT preferences`.

Control (`/api/control/support/`): `GET overview`, `GET cases`,
`GET cases/:id`, `POST cases/:id/assign`, `POST cases/:id/status`,
`POST cases/:id/notes`, `POST cases/:id/messages`, `POST cases/:id/priority`,
`POST cases/:id/escalate`, `POST cases/:id/propose`, `POST cases/:id/resolve`,
`POST cases/:id/sync` (read-only authoritative refresh), `POST cases/:id/inquiry`,
`POST articles`, `POST articles/:id/publish`.

All routes authenticate, check ownership or staff permission, validate input,
enforce rate limits, paginate lists and record audit events. Linked references
are resolved server-side against the caller's own records.

## 6. Existing modules integrated (read-only links)

Payment/Raftline (`PaymentIntent`, `TransactionRecord`, verified receipts,
`ReconciliationCase`), merchant orders/refund requests, subscription invoices,
bill payment intents and reconciliation cases, travel bookings/cancellations/
refunds/international transfers and compliance checks, investment connections,
tax documents, and wallet transactions. A case stores only a permitted summary
plus the authoritative status read via the owning module's service.

## 7. Provider-dependent workflows and limitations

A case may link to existing provider workflows and open an inquiry record, but
it cannot execute or fabricate a refund, reversal, cancellation or provider
response. Merchant refunds remain advisory (Raftline has no refund/reversal
endpoint); biller refund/complaint capabilities are `false` in the sandbox
adapter; travel refunds are provider-reported; international transfers are
preview-only unless an authorized provider is enabled. Timeout/uncertain
outcomes remain `UNKNOWN`/`WAITING_FOR_PROVIDER` until verified through the
existing reconciliation flow, never by a support status change.

## 8. Environment variables and secrets

`NEXUS_SUPPORT_ENABLED` (default `true`),
`NEXUS_SUPPORT_ATTACHMENT_MAX_BYTES` (default 5 MiB),
`NEXUS_SUPPORT_INACTIVITY_REMINDER_HOURS` (default 48),
`NEXUS_SUPPORT_HELP_REVIEW_DAYS` (default 90).
`AUTH_SECRET` derives HMAC keys for signed evidence links;
`TOKEN_ENCRYPTION_KEY` (optional) strengthens AES-256-GCM encryption. No
passwords, PINs, OTPs or credentials are requested or stored; submitted
sensitive text is flagged for staff without being echoed into timelines.

## 9. Windows setup instructions

```powershell
cd C:\Sushrut\projects\nexus-pay
pnpm install
pnpm --filter @nexus/database db:generate
pnpm --filter @nexus/database exec prisma migrate deploy
$env:NODE_OPTIONS="--max-old-space-size=6144"
pnpm dev
```

Production: `pnpm build` then `pnpm --filter @nexus/web start`.

## 10. Worker startup instructions

`startSupportWorker()` is registered in `apps/web/instrumentation.ts` and runs
every 60 seconds with durable `SupportJob` persistence, atomic claim, 5-minute
lease, 3-attempt backoff, dead-lettering and lease recovery. Allowed job kinds:
`INACTIVITY_REMINDER`, `PROVIDER_STATUS_SYNC`, `ESCALATION_EVALUATION`,
`HELP_REVIEW_REMINDER`, `ANALYTICS_AGGREGATION`. No browser timers are used;
mutating financial or provider jobs cannot be enqueued.

## 11. Test commands and results

```powershell
pnpm typecheck                                   # 6/6 packages passed
pnpm lint                                        # no warnings/errors
pnpm test:unit                                   # 21 files, 169 tests passed
$env:RUN_INTEGRATION="1"; $env:RUN_RAFTLINE_INTEGRATION="1"
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/release19-support.test.ts  # 12/12 passed
pnpm test:integration                            # 22 files, 205 tests (see note)
$env:NODE_OPTIONS="--max-old-space-size=6144"; pnpm build   # compiled, 200 pages
pnpm test:e2e                                    # 41 tests (see note)
```

Full integration: 199/205 passed on the first run; six failures were in unrelated
Release 3 and Release 7 suites caused by a transient Raftline leader election
outage while the build and browser suites ran concurrently. Both affected files
passed cleanly on rerun (20/20), giving 205/205 with no code changes. E2E: 40/41
on the final full run; one pre-existing Release 4 finance test flaked on budget
visibility and passed on isolated retry (41/41 effective). The R19 suite passed
3/3 in the full run and on its own rerun.

Coverage includes case creation, ownership rejection, duplicate prevention,
lifecycle, internal-note isolation, escalation, notification de-duplication,
encrypted evidence with signed links, no financial mutation, worker lease
recovery, Help Centre versioning/feedback and analytics.

## 12. Security and privacy implementation summary

Strict per-user case ownership; role-gated staff access; AES-256-GCM encrypted
evidence at rest; HMAC-signed 5-minute download links; forbidden executable
file types and MIME/size validation; audit and security events for privileged
and sensitive actions; internal notes isolated by `INTERNAL_ONLY` visibility
and excluded from customer queries; sensitive-content flagging without content
redistribution; CSRF, rate limits, validation and no-store attachment headers.

## 13. Incomplete features and dependencies

- Real refund/reversal execution — requires an authoritative Raftline/provider
  capability that does not exist.
- Provider complaint submission — sandbox biller `complaints/refunds` are
  `false`; requires a verified provider integration.
- Automated claim decisions or payouts — out of scope; cases remain advisory.
- Real-time chat — not added; the reliable case inbox with notifications is used.
- Advanced SLA commitments — not published; only operational review thresholds
  and actual timestamps are shown.

## 14. Regression test results

Typecheck, lint and unit suites pass with R19 added. Releases 1–18 flows remain
intact: typecheck/lint/unit green, R18 integration and E2E unchanged, and the
R19 suite asserts that resolving a case leaves authoritative transaction status
untouched. Full integration and Playwright regression results are recorded in
the delivery summary for this release.
