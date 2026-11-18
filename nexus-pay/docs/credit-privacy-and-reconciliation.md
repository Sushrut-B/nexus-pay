# Credit document security, privacy and reconciliation

- Applicant documents are validated by MIME type and size (5 MB), encrypted
  with AES-256-GCM and written to private storage outside the web root.
  Download links are HMAC-signed and expire after five minutes.
- Document access, upload and deletion are written to `DataAccessAuditEvent`;
  no file content or PII is logged.
- Strict ownership: another customer cannot view a loan application, document,
  repayment or loan; Nexus Control sees only operational counts and states.
- Provider events are signature-verified and deduplicated by `(providerId,
  providerEventId)`; replays are recorded and never re-applied. Unverified
  payloads are stored as `signatureValid: false` and never processed.
- Provider sync jobs use leases, three attempts and dead-letter states; failed
  jobs can be retried only by authorised operators and are audited.
- No applicant decision can be changed by manually editing a database status.
