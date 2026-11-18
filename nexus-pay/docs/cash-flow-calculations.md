# Cash-flow calculation definitions

All amounts are integer paise. UTC is used internally; Asia/Kolkata is the
customer-facing display timezone.

- **inflow** = verified P2P receipts + cashback counted only after a verified wallet credit. Simulated funding excluded.
- **outflow** = successful merchant payments and P2P sends, reduced by refund adjustments recorded against the original purchase.
- **net** = inflow − outflow.
- **average daily spend** = outflow ÷ days in the selected period.
- **average weekly / monthly spend** = daily average × 7 / × 30.
- **highest / lowest spending day** = maximum / minimum daily outflow bucket.
- **monthly savings estimate** = net cash flow normalized per month, never negative.

Periods: week, month, last month, 3 months, 6 months, year and custom. Every
period also calculates the previous equivalent period for comparisons. Empty
periods show explicit empty states rather than zero-valued charts.
