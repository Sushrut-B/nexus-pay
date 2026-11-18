# Finance Assistant and reports

## Assistant architecture
No LLM provider is integrated. The assistant is a deterministic structured-query
layer: it parses the question into one of a fixed set of intents and calls the
same authorised aggregation services used by the dashboards. It never receives
unrestricted SQL/ORM access, never sends full transaction histories externally,
and enforces the authenticated user's identity on every query. Questions about
other users are refused.

Answers identify the period, distinguish ACTUAL from FORECAST data, show the
calculation where relevant, link to the underlying view and offer follow-ups.

## Reports
Eight report types (monthly/annual summary, category, merchant, subscription,
recurring, budget performance, savings goal) in PDF or CSV. Creation enqueues a
durable job with atomic claiming, leases and bounded retries. Files are written
to `.reports/<userId>/` and downloads are ownership-checked. Reports include the
selected period and calculation definitions and use Asia/Kolkata for display.
