# Referral qualification rules

- Each user receives a unique `NEXUS-XXXXXXXXXX` code and shareable link.
- Self-referral is rejected. A user can be attributed to only one referrer.
- Qualification requires the referred user to complete **one settled merchant
  payment**. The worker records a `ReferralQualification` and issues rewards once:
  100 points to the referrer, 50 points to the referred user.
- Reward issuance is guarded by a unique key per `(attribution, userId, type)`.
- Referral points are non-cash ledger entries; no wallet funds move automatically.

## Risk controls
Repeated codes, rapid referral creation and duplicate account relationships are
recorded as `RewardRiskEvent` rows for investigation. No user is automatically
accused of fraud; risk indicators trigger review only.
