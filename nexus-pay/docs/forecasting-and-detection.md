# Recurring detection, forecasting, anomalies and health scoring

## Recurring detection
Groups settled merchant payments and P2P sends by merchant/recipient and similar
amount (±25%). Three or more occurrences with consistent intervals produce a
`DETECTED` pattern with supporting evidence, frequency, confidence and next
expected date. Detection **never** creates a scheduled payment — the user must
confirm the pattern.

## Forecasting
`rolling_average_3m` on monthly buckets: prediction is the mean of the last three
monthly totals; uncertainty is ±30%. Fewer than six historical records returns
an explicit unavailable state. Every forecast stores method, assumptions,
history count and date range. Predictions are not guarantees.

## Anomalies
A transaction is flagged when it exceeds the user's own five-month category
baseline by at least 80% and at least ₹100. Severity scales with the deviation.
Findings are informational, never fraud determinations, and users can mark them
expected, dismiss or review them.

## Financial health score
`Weighted mean of six 0–100 dimensions: budget adherence 20%, savings consistency 20%,
cash-flow stability 15%, recurring commitment ratio 15%, spending volatility 15%,
goal progress 15%. Unavailable when fewer than 10 monetary records or one month
of history exist.` Each dimension stores its numeric inputs and explanation.
This is **not** a credit score and does not predict loan eligibility.
