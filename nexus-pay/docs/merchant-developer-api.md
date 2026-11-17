# Merchant developer API

Base: `/api/v1/merchant` (sandbox).

## Authentication

Send `Authorization: Bearer <secret>` or `X-Nexus-API-Key`. Secrets start with `npk_`, are generated with 32 random bytes, stored as HMAC hashes, shown once at creation and never retrievable. Scopes are enforced server-side: `payments:read`, `payments:create`, `orders:read`, `orders:create`, `payment_links:read`, `payment_links:create`, `refunds:read`, `refunds:create`. Merchant-specific rate limits apply.

## Endpoints

| Method | Route | Scope |
| --- | --- | --- |
| GET | `/api/v1/merchant/orders` | `orders:read` |
| POST | `/api/v1/merchant/orders` | `orders:create` |

Order creation body:

```json
{
  "title": "Order #12",
  "items": [{ "title": "Tea", "quantity": 2, "unitPriceMinor": 5000 }],
  "taxMinor": 0,
  "discountMinor": 0
}
```

Amounts are integer paise; currency is INR. Responses echo the persisted order with computed `totalMinor`.

Webhook signature verification is documented in `merchant-webhooks.md`.
