# Nexus Pay Merchant Ecosystem

Sandbox merchant payments inside Nexus Pay. Raftline remains authoritative for all money movement; merchant tables are application metadata.

## Onboarding

1. Open **For Business** → **Start accepting payments**.
2. Enter business information (name, display name, handle, type, category, contact).
3. Save a draft — progress is persisted.
4. Provision the business wallet through the existing verified Raftline account flow. Retrying is safe: the account id is deterministic and checked first.
5. Submit for sandbox review. A Nexus Control super admin approves under **Merchants**.
6. Only `ACTIVE` merchants can accept payments. Approval is application-level, not KYC or real-world authorization.

## Dashboard

Shows payment volume, successful/pending/failed counts, orders, customers, recent payments and the **available business wallet balance read live from the mapped Raftline account** (`Unavailable` when the ledger cannot be read — no balance is guessed). All payment metrics derive from verified `MerchantPayment` records; there is no calculated merchant ledger.

## Orders & links

Orders store line items in integer paise: `total = subtotal + tax − discount`. Payment links use unpredictable 24-byte tokens and derive the amount server-side at checkout.

## QR payments

- **Static QR:** resolves the merchant handle, customer enters an amount, Nexus Pay settles internally. Not a UPI QR — only Nexus Pay can pay it.
- **Dynamic QR:** generated from a payment link (`/merchant/payment-links/{id}/qr`). It encodes the `/pay-link/{token}` checkout URL, so the payable amount is fixed server-side and the customer cannot change it. Both QR types resolve to a real Nexus Pay payment experience; no external app can pay them.

## Checkout

`GET /pay-link/{token}` shows merchant branding, description and the server-derived amount. Sign-in is required to confirm. `POST /api/checkout/{token}/confirm` reuses a client UUID as the payment-intent key, settles via the existing engine, updates the order only after verified settlement, and writes webhook outbox events.

## Refunds

Raftline has **no refund/reversal operation**. Merchants can request and administrators can review refunds, but no money is moved and no refund is marked `SUCCEEDED` by execution. See `merchant-refunds.md`.

## Security

Merchant ownership is checked on every resource. Public tokens are unguessable, rate limited, expiry-checked and cannot change amounts. API keys are hashed and scoped. Webhooks are HMAC-SHA256 signed, delivered from a durable outbox with exponential backoff and a dead-letter state, and can be manually retried from the developer portal.
