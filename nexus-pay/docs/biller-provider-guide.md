# Biller Provider Adapter & Onboarding Guide

## Regulatory context

Official sources reviewed: RBI's BBPS notification and NPCI Bharat Connect (BBPS) procedural guidelines/circulars. NPCI Bharat BillPay Limited operates the central unit; participating Operating Units require RBI authorisation/intimation. Nexus Pay has **no verified authorisation**, so no BBPS/Bharat Connect/BBPOU claim is made and no real biller is fabricated. Only an explicitly labelled sandbox provider is configured.

## Adapter interface

`BillPaymentProviderAdapter` (`apps/web/lib/billing/biller-adapter.ts`) declares:

`getProviderDetails`, `getCapabilities`, `getCategories`, `getBillers`, `getBillerDetails`, `getRequiredParameters`, `validateCustomerDetails`, `fetchBill`, `verifyBill`, `initiatePayment`, `getPaymentStatus`, `getTransactionStatus`, `requestRefundOrReversal`, `getComplaintStatus`, `getPlans`, `initiateRecharge`, `getRechargeStatus`, `verifyWebhook`.

Every adapter declares `BillerCapabilities`; unsupported operations must be false and callers must check them. Bill parameters come from provider metadata, not hardcoded names. All amounts are integer minor units.

## Adding a provider

1. Implement the adapter in `lib/billing/providers/`.
2. Add it to `adapters` in `lib/billing/providers/index.ts` and to `isBillerProviderEnabled`.
3. Store credentials in environment/secret management only.
4. Complete the regulatory and contractual prerequisites above before enabling in production.

## Webhooks

`POST /api/bill-payments/webhooks/:providerCode` verifies HMAC-SHA256 signatures over `${timestamp}.${JSON.stringify(payload)}`, deduplicates by `(providerId, eventId)`, persists the callback and processes it asynchronously via `BillProviderSync`. Only verified events update payment state. Poll documented status APIs where webhooks are unavailable.

## Status

| Capability | Status |
| --- | --- |
| Adapter, registry, catalogue, accounts, fetch, payment, recharge, reminders, households | Implemented |
| Sandbox provider (`sandbox-biller`) | Sandbox only (`NEXUS_BILLING_SANDBOX_ENABLED=true`) |
| Real biller / BBPS / Bharat Connect | Not connected |
| Refunds, reversals, complaints, auto-pay execution | Architecture-ready, not connected |
