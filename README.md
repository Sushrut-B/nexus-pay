<div align="center">

# Nexus Pay

**Consumer payments · Social finance · Personal intelligence · Merchant ecosystem · Cluster operations**

[![Stack](https://img.shields.io/badge/stack-Next.js%2015%20%7C%20React%2019%20%7C%20TypeScript-blue)](https://nextjs.org/)
[![Ledger](https://img.shields.io/badge/ledger-Raftline%205--node-green)](#architecture)
[![Tests](https://img.shields.io/badge/tests-53%20unit%20%7C%2055%20integration%20%7C%208%20E2E-brightgreen)](#verification)
[![Mode](https://img.shields.io/badge/mode-SIMULATED%20SANDBOX-orange)](#sandbox-notice)

[Overview](#overview) · [Quick start](#quick-start) · [Features](#features) · [Architecture](#architecture) · [Verification](#verification) · [Docs](#documentation)

</div>

> This repository contains both **Nexus Pay** (in [`nexus-pay/`](nexus-pay)) and the **Raftline** cluster. Original Raftline docs: [`RAFTLINE.md`](RAFTLINE.md).

---

## Overview

Nexus Pay is a full payments and finance platform backed by a live five-node **Raftline** cluster. It evolved across six releases without rebuilding earlier work.

| Release | Delivered |
| --- | --- |
| **R1** | Authentication, onboarding, PostgreSQL, wallet provisioning, Raftline adapter with dynamic leader discovery |
| **R2** | Wallet dashboard, simulated funding, P2P transfers, receive/QR, transaction history, receipts, idempotency and recovery |
| **R3** | Contacts, payment requests, groups, expense splitting, balances, debt simplification, verified settlements, notifications |
| **R4** | Insights, categorization rules, budgets, savings goals, scheduled payments + durable worker, recurring detection, calendar, PDF/CSV statements |
| **R5** | **Nexus Control** — isolated admin console, RBAC, live cluster monitoring, chaos engineering, payment reconciliation, metrics, alerts, audit |
| **R6** | **Merchant ecosystem** — business accounts, orders, payment links, merchant QR, checkout, verified settlement, refund requests, analytics, webhooks, scoped developer APIs |

> [!IMPORTANT]
> <a name="sandbox-notice"></a>
> **Sandbox only.** Funding is labelled **SIMULATED SANDBOX FUNDING**. There is no bank, UPI, card or real-money integration, and no regulatory claim. Merchant approval is application-level (not KYC), merchant QR is a Nexus Pay QR (not UPI), and **Raftline has no refund/reversal capability** — refunds stop at request/review with no money moved.

<details>
<summary><b>Core financial rules</b> (click to expand)</summary>

- Raftline is the only ledger. PostgreSQL stores metadata, never authoritative balances.
- Success requires a verified committed receipt — HTTP acceptance is not success.
- Ambiguous outcomes stay `UNKNOWN` / `RECONCILIATION_REQUIRED`.
- No new idempotency key after a timeout; repeated submissions reuse the original intent.
- Analytics, budgets and savings goals are derived/tracking metadata, never a second ledger.
- Merchant payment state is set only after a verified Raftline settlement; checkout links never move money themselves.
- Raftline has no reversal operation, so refunds are request + audited review only — never a simulated payout.
- Webhook delivery is asynchronous via a durable outbox; it never runs inside a settlement transaction.

</details>

---

## Quick start

```powershell
# 1. Infrastructure
docker compose up -d
cd C:\Sushrut\projects\Raftline
.\scripts\start-5node-cluster.ps1

# 2. Application
cd C:\Sushrut\projects\nexus-pay
pnpm install
pnpm db:generate
pnpm db:deploy
pnpm dev
```

| URL | Purpose |
| --- | --- |
| `http://localhost:3000` | Nexus Pay customer app |
| `http://localhost:3000/merchant` | Nexus Pay for Business (merchant dashboard) |
| `http://localhost:3000/control` | Nexus Control admin console |

Copy `nexus-pay/apps/web/.env.example` → `nexus-pay/apps/web/.env.local`. Register the tenant with `cd nexus-pay; .\scripts\ensure-raftline-tenant.ps1`.

---

## Features

<details open>
<summary><b>Customer app</b></summary>

| Area | Routes |
| --- | --- |
| Wallet & payments | `/home`, `/wallet`, `/wallet/add-money`, `/send`, `/receive`, `/transactions` |
| Social | `/contacts`, `/requests`, `/groups`, `/groups/[groupId]/settle` |
| Finance | `/insights`, `/insights/spending`, `/transactions/categories`, `/budgets`, `/savings`, `/scheduled`, `/calendar`, `/statements` |

</details>

<details open>
<summary><b>Nexus Pay for Business</b></summary>

| Area | Routes |
| --- | --- |
| Onboarding | `/merchant/onboarding` — business info, wallet provisioning, sandbox review |
| Operations | `/merchant`, `/merchant/orders`, `/merchant/payment-links`, `/merchant/qr`, `/merchant/customers`, `/merchant/refunds`, `/merchant/analytics` |
| Integrations | `/merchant/developers`, `/merchant/settings` |
| Customer checkout | `/pay-link/[token]`, `/merchant-qr/[handle]` |

Payments settle through the existing Raftline engine; merchant tables are metadata only. Webhooks are HMAC-SHA256 signed and delivered from a durable outbox.

</details>

<details>
<summary><b>Nexus Control (admin)</b></summary>

| Section | Capability |
| --- | --- |
| Overview / Cluster / Nodes | Live health, dynamic leader, node detail, sampled history |
| Leader Elections | Observed transitions, including re-elections via term changes |
| Chaos Engineering | Real Raftline inject/heal with reason, confirmation, rate limit, quorum safety |
| Payments / Reconciliation | Masked investigation, evidence-based resolution without replay |
| Metrics / Alerts | Nexus-observed samples, deduplicated incidents |
| Merchants / Merchant Refunds | Sandbox approval, suspension, refund request review (all audited) |
| Audit / Diagnostics / Admin | Append-only audit, structured logs, role management |

**RBAC:** `SUPER_ADMIN` → all · `OPERATOR` → operate, no admin management · `VIEWER` → read-only. Chaos is disabled by default (`NEXUS_CONTROL_CHAOS_ENABLED=false`).

</details>

---

## Architecture

```mermaid
flowchart LR
  UI[Customer app<br/>/ ...] --> API[Nexus Pay API<br/>auth · idempotency · services]
  CUI[Nexus Control<br/>/control] --> CADMIN[Admin API<br/>RBAC · audit]
  API --> DB[(PostgreSQL<br/>metadata + observations)]
  CADMIN --> DB
  API --> RAFT[Raftline cluster<br/>node-1 ... node-5]
  CADMIN --> RAFT
  RAFT --> LEDGER[(Authoritative<br/>balances + receipts)]
  DB -.derived views.-> API
```

- The browser never talks to Raftline directly.
- Scheduled payments use a durable PostgreSQL job queue with atomic claiming and stable execution keys.
- Budgets do not reserve funds; savings goals do not move money.
- Merchant webhooks use a transactional outbox plus an async worker; failures never reverse a payment.
- Merchant API keys are stored as hashes, scoped, and rate-limited per merchant.

---

## Verification

| Gate | Result |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | Passed |
| `pnpm test:unit` | **53 passed** |
| `pnpm test:integration` | **55 passed** (live Raftline + PostgreSQL) |
| Playwright E2E | **8 passed** (production mode) |
| Live failover drill | Leader failure → new term → heal → payment settled → reconciled → audited |

```powershell
cd nexus-pay
pnpm test:unit
pnpm test:integration
pnpm exec playwright test --config playwright.prod.config.ts
```

---

## Documentation

- [Nexus Pay README](nexus-pay/README.md)
- [API reference](nexus-pay/docs/api.md) · [Environment setup](nexus-pay/docs/environment-setup.md) · [Raftline integration](nexus-pay/docs/raftline-integration.md)
- [Nexus Control](nexus-pay/docs/nexus-control.md) · [Runbooks](nexus-pay/docs/nexus-control-runbooks.md) · [Assessment](nexus-pay/docs/nexus-control-assessment.md)
- Merchant: [Guide](nexus-pay/docs/merchant-guide.md) · [Refunds](nexus-pay/docs/merchant-refunds.md) · [Webhooks](nexus-pay/docs/merchant-webhooks.md) · [Developer API](nexus-pay/docs/merchant-developer-api.md) · [Assessment](nexus-pay/docs/release-6-assessment.md)
- Reports: [R2](nexus-pay/docs/release-2-report.md) · [R3](nexus-pay/docs/release-3-report.md) · [R4](nexus-pay/docs/release-4-report.md) · [R5](nexus-pay/docs/release-5-report.md) · [R6](nexus-pay/docs/release-6-report.md)
