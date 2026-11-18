# Encryption, privacy and retention

- Provider tokens and account references are encrypted with AES-256-GCM
  (`apps/web/lib/security/crypto.ts`). The key is `TOKEN_ENCRYPTION_KEY` or a SHA-256
  derivation of `AUTH_SECRET`; production deployments should configure and manage a
  dedicated key. Ciphertext format is `iv.tag.ciphertext` (base64url). No plaintext
  secret is returned by any API, placed in logs, or included in Control views.
- Bank passwords, UPI PINs, OTPs and card PINs are never requested or stored.
- Imported provider data is retained only while consent is active, subject to legal
  and audit retention obligations. Disconnection stops future retrieval; deletion
  requests are recorded and reviewed rather than silently erasing audited history.
- All data-access and privileged actions are written to `DataAccessAuditEvent`;
  Nexus Control actions additionally use `recordAdminAudit`.
