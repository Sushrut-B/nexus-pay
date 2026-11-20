# Release 13 — Fraud Intelligence & Security Platform: Audit & Implementation Plan

## Phase 0 — Verification

At baseline commit `3586386` (`feat(nexus-pay): Release 12 insurance marketplace and policy management`), Releases 1–12 are present and green: `pnpm typecheck`, `pnpm lint`, and `pnpm test:unit` (91 tests) pass. Release 12 added 22 insurance metadata models, customer/Control APIs, a labelled sandbox insurer and durable webhook/sync workers without rewriting earlier releases.

## Raftline / financial boundary (non-negotiable)

Raftline remains the only authoritative engine for wallet balances and committed transactions. The fraud platform is a **read-only observer** of financial activity:

- Risk evaluation never writes a wallet balance, creates a payment intent, debits a wallet, or mutates a committed Raftline transaction.
- A blocked payment is a decision returned to the existing payment flow before submission; it is never a settlement attempt.
- A settled suspicious transaction creates an investigation case; it is never falsely relabelled as reversed.
- Uncertainty (`PAYMENT_UNKNOWN`) stays unknown; no blind retries, no idempotency-key changes.

## Regulatory /_privacy posture

Risk scoring is an explainable indicator, not a proven fraud probability or a basis for permanently blocking a customer. No protected or sensitive personal attributes are used as risk signals. Sensitive event metadata is restricted and masked. Shared devices, IPs or referrals are **signals for investigation**, never proof of fraud. No fabricated fraud labels, incidents, statistics or ML accuracy claims.

## Implementation plan

1. **Event inventory** (see `docs/security-event-inventory.md`) — verified sources only.
2. **Event platform**: immutable `SecurityEvent`, transactional `SecurityEventOutbox`, idempotent publication worker, versioned schemas, retention.
3. **Risk engine**: explainable 0–100 score, configurable classifications/actions, rule signals, versioned policies, explicit fallback when unavailable, four evaluation modes.
4. **Rules**: deterministic, versioned, configurable authentication/payment/merchant/rewards/application rules with audited configuration.
5. **Behavioral analytics**: rolling mean, MAD, EMA, frequency and cold-start handling; no ML theatre.
6. **Payment gateway**: read-only evaluation inserted before the existing payment orchestration; explicit actions; original idempotency preserved.
7. **ATO / sessions / devices**: session risk, trusted devices, sensitive-action reauthentication (MFA extension point, no fake MFA), user-controlled revocation.
8. **Scam protection**: contextual warnings, education centre, no disclosure of internal thresholds.
9. **Cases & reports**: investigation lifecycle, internal-only notes, customer fraud reporting with truthful settlement status.
10. **ML / network foundation**: advisory model interface, versioned features/models, PostgreSQL relationship tables; no trained-model claims.
11. **APIs, Control centre, UI, tests, docs**, then full verification gates.

## Safety rules

- Explain every score with triggered rules and contributing signals.
- Alert ≠ report ≠ dispute ≠ confirmed fraud ≠ reversed transaction.
- Every manual risk decision is audited.
- Event processing is idempotent and recoverable.
