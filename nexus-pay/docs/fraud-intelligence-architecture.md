# Fraud Intelligence — Architecture

## Design principles

1. **Read-only observer.** Risk operations never mutate wallets, payment intents or Raftline balances.
2. **Explainable.** Every score lists the rules and signals that produced it.
3. **Configurable.** Thresholds, contributions, windows, actions and rules live in versioned database rows.
4. **Durable and idempotent.** Events flow through a transactional outbox into an immutable store; event IDs are unique.
5. **Honest.** Alerts, reports, disputes, confirmed fraud and reversals are distinct concepts. No fabricated metrics.

## Flow

```
Domain modules ──publishSecurityEvent()──> SecurityEventOutbox
                                              │ (worker: claim/lease/backoff)
                                              ▼
                                        SecurityEvent (immutable)
                                              │
                      ┌───────────────────────┼───────────────────────┐
                      ▼                       ▼                       ▼
             RiskEvaluation            BehavioralBaseline     Relationship analysis
             (rules + policy)          (MAD/EMA, cold start)  (signals only)
                      │
                      ├── RiskAlert ──> FraudCase ──> notes/evidence/escalation/resolution
                      └── TransactionRiskAssessment ──> payment gateway decision
```

## Event schema

Every event has an event ID, type, schema version, occurrence and record timestamps, actor/subject/account/session IDs, source module, correlation and request IDs, device ID, privacy-preserving IP hash, transaction reference and bounded structured metadata. Passwords, OTPs, PINs, tokens, full card numbers and similar fields are stripped before persistence. See `docs/security-event-inventory.md` for the verified source list.

## Distinctions

| Term | Meaning |
| --- | --- |
| Risk alert | A rule-driven indicator from observed events; not confirmed fraud. |
| Suspicious activity | Unusual but unverified behaviour. |
| Customer report | A customer's concern; recorded for investigation. |
| Dispute | A claim about a transaction; settlement status is unchanged. |
| Confirmed fraud | Only where a verified investigation resolution exists. |
| Reversed transaction | Only via an existing verified reversal process; the fraud module never reverses. |

## Retention

Security events carry `retentionExpiresAt` based on `NEXUS_FRAUD_RETENTION_DAYS` (default 365). Sensitive metadata is minimized at publication. Investigation cases and audit events are retained separately and are not deleted by event retention.
