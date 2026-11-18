# Subscriptions & recurring billing — merchant guide

## Plans

Create a plan under **For Business → Plans** with name, amount, currency (INR),
frequency (daily/weekly/monthly/quarterly/yearly/custom), interval count, optional
free trial, optional introductory price and periods, optional setup fee and a
cancellation policy. Publishing sets the plan to `ACTIVE`; it then has a shareable
checkout URL `/subscribe/{token}`.

Only `ACTIVE` plans on `ACTIVE` merchants can be purchased. Archiving a plan stops
new subscriptions but does not affect existing subscribers.

**Pricing snapshots.** When a customer subscribes, the plan's exact price is copied
into the subscription as an immutable snapshot. Editing or archiving a plan never
changes what an existing subscriber pays. A plan change is recorded with an explicit
`UPGRADE`, `DOWNGRADE` or `SIDEWAYS` direction (based on normalized monthly value) and
takes effect at the next billing period. No proration is attempted.

## Checkout

The public checkout shows the merchant, plan, recurring amount, first billing date,
trial information, introductory price, setup fee and cancellation policy. The
customer signs in, accepts the sandbox recurring-billing terms and confirms. If a
payment is due today it is settled immediately through the existing payment engine;
a free trial collects nothing.

## Lifecycle

States: `PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`,
`CANCELLATION_SCHEDULED`, `CANCELLED`, `EXPIRED`, `INCOMPLETE`,
`REQUIRES_CUSTOMER_ACTION`. Transitions are server-enforced and appended to an
immutable event history (created, trial started, activated, renewal attempted,
payment succeeded/failed, paused, resumed, plan changed, cancellation requested,
cancelled).

Merchants can pause, resume, cancel and change plans from the subscription detail
page. Customers can request end-of-period cancellation from their portal.

## Billing calendar

Monthly and quarterly billing clamp to the last valid day of the target month:
Jan 31 → Feb 28 → Mar 28, Mar 31 → Apr 30, leap-day Feb 29 → Feb 28. Yearly billing
preserves the anchor where possible. All arithmetic is UTC-based and independent of
the server's local timezone; subscriptions store an explicit billing timezone
(`Asia/Kolkata` by default).

## Invoices

Every billing occurrence produces a merchant-scoped invoice with an atomic sequence
number (`INV-YYYY-NNNNNN`). PDFs are sandbox documents — no tax registration number
or compliance claim is made.

## Dunning

Failed payments are classified from actual Raftline responses: insufficient balance,
wallet unavailable, customer action required, temporary infrastructure failure,
unknown outcome, or permanent rejection. Retry windows default to 1, 3 and 5 days;
uncertain outcomes are never retried until reconciled. Retried attempts are never
reported as successful payments.

## Webhooks & Nexus Control

Subscribers can subscribe endpoints to `subscription.created`, `subscription.trial_started`,
`subscription.activated`, `subscription.trial_ended`, `subscription.past_due`,
`subscription.paused`, `subscription.resumed`, `subscription.plan_changed`,
`subscription.cancellation_scheduled`, `subscription.cancelled`, `invoice.created`,
`invoice.paid` and `invoice.past_due`, in addition to the existing payment events.
Events are HMAC-SHA256 signed and delivered by the shared durable outbox worker.

Nexus Control → **Subscriptions** and **Billing Operations** provide read-only,
RBAC-protected visibility into subscriptions, invoices and unresolved outcomes across
all merchants. No privileged settlement action is exposed there.
