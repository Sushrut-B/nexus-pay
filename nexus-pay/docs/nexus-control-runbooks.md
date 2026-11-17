# Nexus Control — Operational Runbooks

## Reconciliation runbook

Use when a payment is `UNKNOWN` or `RECONCILIATION_REQUIRED`.

1. Open **Payments** in Nexus Control and search by reference, intent id or
   masked idempotency key.
2. Confirm the payment status and settlement interpretation. An idempotent
   replay is the original result, not a second payment.
3. Open **Reconciliation** and create a case from the intent (or use the button
   on the payment detail page).
4. Click **Query Raftline evidence**. Nexus Control calls
   `getTransaction(paymentRef)` and stores the response as evidence. It never
   resubmits the payment.
5. Inspect the evidence: receipt status, amount, currency, masked accounts,
   idempotent replay flag and raft log index.
6. Only when a matching receipt exists, record a decision:
   - `RESOLVED_SETTLED` requires a `SETTLED` receipt whose amount equals the
     intent amount.
   - `RESOLVED_REJECTED` requires rejection evidence.
   - Otherwise choose `UNRESOLVED`; the case remains open for further work.
7. Verify the audit log contains `RECONCILIATION_CASE_OPENED`,
   `RECONCILIATION_EVIDENCE_QUERIED` and `RECONCILIATION_RESOLVED`.

Never: create a new idempotency key, replay a payment, manually edit balances,
mark an unverified payment settled, or mark an unresolved payment rejected
without evidence.

## Incident investigation runbook

1. Open **Overview**. Record health, leader, term, commit/applied index and the
   last status update time.
2. If data is stale or unavailable, check **Diagnostics** and the last stored
   snapshots; do not assume the cluster is healthy.
3. Open **Cluster** and **Nodes** to identify unreachable nodes.
4. Open **Leader Elections** to see observed transitions. A term change with
   the same leader is a re-election; exact election timing is unavailable.
5. Open **Alerts** for deduplicated incidents and suggested investigation steps.
   Acknowledge with a reason when work starts.
6. If a chaos operation caused the incident, open **Chaos Engineering** →
   operation history, then heal the affected node and confirm recovery with new
   observations.
7. Execute a small test payment through Nexus Pay and confirm it settles in
   **Payments** with no duplicate debit.
8. Review **Audit Logs** to attribute every administrative action.
9. Resolve or close alerts when the condition clears; the collector resolves
   alerts automatically when the underlying condition is no longer observed.

## Leader failure drill (development cluster only)

1. Confirm the cluster is HEALTHY with at least four nodes reachable.
2. In **Chaos Engineering**, select the currently observed leader and
   `KILL_LEADER`, provide an incident reference, review impact and confirm.
3. Observe the term change and leader transition in **Leader Elections**.
4. Heal the affected node with `Heal all faults`.
5. Verify the node becomes reachable and cluster health returns to HEALTHY.
6. Execute a payment and verify settlement and audit records.

Never perform this drill against a production cluster.
