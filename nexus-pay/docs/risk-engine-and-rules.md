# Risk Engine & Rule Configuration

## Scoring

`computeEvaluation` evaluates enabled rules against an input context. Each matched rule contributes its configured weight (0–100). Contributions are summed and capped at 100. The score is a **risk indicator**, not a fraud probability.

| Score | Classification (configurable defaults) |
| --- | --- |
| 0–24 | LOW |
| 25–49 | MODERATE |
| 50–74 | HIGH |
| 75–100 | CRITICAL |

Thresholds and per-classification actions are stored in `RiskPolicy` (`default`). Changing a policy increments its version and writes a `SecurityAuditEvent`.

## Actions

ALLOW · ALLOW_WITH_MONITORING · REQUIRE_STEP_UP_AUTHENTICATION · REQUIRE_CUSTOMER_CONFIRMATION · HOLD_FOR_MANUAL_REVIEW · BLOCK_INITIATION.

A risk score alone never changes a ledger or permanently blocks an account. Pre-transaction blocking stops intent creation; it is not a settlement attempt.

## Fallback policy

If `NEXUS_FRAUD_ENGINE_ENABLED=false`, evaluation is forced to fall back, or the engine throws, the configured `NEXUS_FRAUD_FALLBACK_ACTION` is returned with an explicit explanation and a `RISK_ENGINE_FALLBACK` / `RISK_ENGINE_FAILURE_FALLBACK` audit event. No check is silently bypassed.

## Rules

Rules are deterministic functions in `lib/fraud/rules.ts`, seeded into `FraudRule` rows with configurable thresholds, windows, contributions and actions. Administrators can create, update, enable/disable and review version snapshots. Every change is audited with a justification. Rule executions are recorded against evaluations.

Cold-start users are excluded from amount-deviation detection until at least five baseline samples exist; absence of history is not a risk signal. MFA-failure rules can never fire while MFA is absent, because no such event is published.

## Behavioral analytics

Rolling mean, mean absolute deviation (MAD, scaled by 1.4826) and exponential moving average (alpha 0.2). Anomaly scores are bounded 0–100 and require a mature baseline. See `lib/fraud/behavioral.ts`.
