# Environment Setup

Local development and verification guide for Nexus Pay Release 1.

## 1. Prerequisites

| Requirement | Version or note |
| --- | --- |
| Node.js | `>=20.9.0` |
| pnpm | `11.8.0` via Corepack or global install |
| Docker Desktop | For PostgreSQL and optional Mailpit |
| PostgreSQL | 16, provided by Docker Compose |
| Raftline | Five-node cluster running on HTTP ports `8001`-`8005` |
| Java | Required only to build or start Raftline |
| Maven | Required only to build Raftline |
| Playwright Chromium | Installed with `pnpm exec playwright install chromium` |

Expected local ports:

| Port | Service |
| --- | --- |
| `3000` | Nexus Pay Next.js |
| `5433` | PostgreSQL host mapping |
| `1025` | Mailpit SMTP |
| `8025` | Mailpit web UI |
| `8001`-`8005` | Raftline HTTP REST |
| `9001`-`9005` | Raftline gRPC |

Do not run another service on port `3000` while executing Playwright unless it is
an already-running Nexus Pay dev server. Playwright reuses an existing server.

## 2. Start Raftline

The cluster may already be running. Check first:

```powershell
1..5 | ForEach-Object {
  try {
    Invoke-RestMethod "http://localhost:800$_/v1/cluster/status" |
      Select-Object nodeId, role, term, leaderId
  } catch {
    Write-Host "node-$_ unavailable"
  }
}
```

If the nodes are not running:

```powershell
Set-Location C:\Sushrut\projects\Raftline
mvn clean package -DskipTests
.\scripts\start-5node-cluster.ps1
```

The first build can take several minutes. Verify that one node reports
`role: LEADER`. Do not edit Raftline as part of Nexus Pay setup; it is an external
dependency and the authoritative ledger.

Stop the cluster only when it is safe:

```powershell
Set-Location C:\Sushrut\projects\Raftline
.\scripts\stop-5node-cluster.ps1
```

## 3. Start infrastructure

From the Nexus Pay repository:

```powershell
Set-Location C:\Sushrut\projects\nexus-pay
docker compose up -d
docker compose ps
```

This starts:

- `nexuspay-postgres` on host port `5433`, database `nexus_pay`.
- `nexuspay-mailpit` with SMTP on `1025` and UI at
  `http://localhost:8025`.

PostgreSQL credentials:

```text
user: nexuspay
password: nexuspay
database: nexus_pay
```

If an older Docker volume was created when the container database was named
`nexuspay`, the `nexus_pay` database may be missing. Check and create it:

```powershell
docker exec nexuspay-postgres psql -U nexuspay -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'nexus_pay'"
docker exec nexuspay-postgres psql -U nexuspay -d postgres -c "CREATE DATABASE nexus_pay OWNER nexuspay;"
```

Only run the `CREATE DATABASE` command if the first command returns no row.

## 4. Install dependencies

From the repository root:

```powershell
corepack enable
pnpm install
```

The workspace allows required install scripts for Prisma and esbuild through
`pnpm-workspace.yaml`. If dependency installation is blocked, verify those
`allowBuilds` entries are present.

Install the Playwright browser once:

```powershell
pnpm exec playwright install chromium
```

## 5. Configure environment files

Nexus Pay uses two environment files:

| File | Consumer |
| --- | --- |
| `apps/web/.env.local` | Next.js application, adapter, auth and tests. |
| `packages/database/.env` | Prisma CLI commands. |

Both are gitignored. Never commit real secrets.

Copy the template for the web application:

```powershell
Copy-Item .env.example apps/web/.env.local
```

Then edit `apps/web/.env.local`.

Create `packages/database/.env` with the same database URL:

```dotenv
DATABASE_URL="postgresql://nexuspay:nexuspay@localhost:5433/nexus_pay?schema=public"
```

Generate a session secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Place the output in `AUTH_SECRET`. It must be at least 32 characters. Changing it
invalidates all existing sessions and password reset tokens.

### Required web settings

```dotenv
DATABASE_URL="postgresql://nexuspay:nexuspay@localhost:5433/nexus_pay?schema=public"
AUTH_SECRET="<at-least-32-random-characters>"
APP_URL="http://localhost:3000"
```

`APP_URL` must match the browser origin. It is used for CSRF origin validation
and password reset links.

### Session settings

```dotenv
SESSION_TTL_HOURS="24"
SESSION_REMEMBER_ME_DAYS="30"
```

### Password recovery

```dotenv
PASSWORD_RESET_TOKEN_TTL_MINUTES="30"
PASSWORD_RESET_DEV_MODE="true"
```

`PASSWORD_RESET_DEV_MODE=true` returns the reset link in the API response so the
UI can display it during local testing. Set it to `false` in production.

Optional SMTP:

```dotenv
SMTP_HOST="localhost"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASSWORD=""
MAIL_FROM="Nexus Pay <no-reply@nexuspay.local>"
```

With Mailpit running, the reset email is visible at `http://localhost:8025`. If
`SMTP_HOST` is empty, email delivery is disabled.

### Sandbox integration flags (Releases 10–12)

```dotenv
NEXUS_EXTERNAL_SANDBOX_ENABLED="false"
NEXUS_CREDIT_SANDBOX_ENABLED="false"
NEXUS_INSURANCE_SANDBOX_ENABLED="false"
```

These gates enable clearly labelled test-provider fixtures only. Keep them
`false` in production. `NEXUS_INSURANCE_SANDBOX_ENABLED=true` enables the
demonstration insurer; no real insurer, quote, policy or claim exists.

For local end-to-end runs that create several users, set `E2E_TEST_MODE=true`
to raise the in-memory rate-limit thresholds. Production defaults are unchanged.

Release 13 fraud intelligence:

```dotenv
NEXUS_FRAUD_ENGINE_ENABLED="true"
NEXUS_FRAUD_GATEWAY_ENABLED="true"
NEXUS_FRAUD_FALLBACK_ACTION="REQUIRE_CUSTOMER_CONFIRMATION"
NEXUS_FRAUD_RETENTION_DAYS="365"
```

The gateway is read-only; it is inserted before payment creation and never changes a wallet, payment intent or Raftline transaction. The fallback action is applied explicitly and audited if the engine is unavailable.

### Raftline settings

Preferred per-node configuration:

```dotenv
RAFTLINE_NODE_1_URL="http://localhost:8001"
RAFTLINE_NODE_2_URL="http://localhost:8002"
RAFTLINE_NODE_3_URL="http://localhost:8003"
RAFTLINE_NODE_4_URL="http://localhost:8004"
RAFTLINE_NODE_5_URL="http://localhost:8005"
RAFTLINE_TENANT_ID="nexuspay"
RAFTLINE_TIMEOUT_MS="5000"
RAFTLINE_LEADER_CACHE_TTL_MS="2000"
RAFTLINE_ACCOUNT_CREATE_MODE="auto"
```

Alternative single setting:

```dotenv
RAFTLINE_BASE_URLS="http://localhost:8001,http://localhost:8002,http://localhost:8003,http://localhost:8004,http://localhost:8005"
```

Optional authentication:

```dotenv
RAFTLINE_API_KEY=""
```

The adapter also accepts these compatibility aliases:

- `RAFTLINE_REQUEST_TIMEOUT_MS` for the timeout.
- `RAFTLINE_ACCOUNT_CREATION_MODE` for the create mode, including legacy values
  `api` (maps to `official`) and `kv_compat` (maps to `kv`).

Prefer the canonical key names and values shown above. The web environment
validator only accepts `auto`, `official` or `kv` for
`RAFTLINE_ACCOUNT_CREATE_MODE`.

Allowed create modes:

| Mode | Use |
| --- | --- |
| `auto` | Default. Official create, read-back, safe KV fallback. |
| `official` | Official API only; fails if the account does not persist. |
| `kv` | Compatibility write path only. |

Do not use `kv` mode as a production preference. It exists because of the
Raftline account-create defect documented in `docs/raftline-integration.md`.

## 6. Generate Prisma Client and migrate

```powershell
pnpm db:generate
pnpm db:migrate
```

For a fresh local database, `pnpm db:migrate` applies the migration and seeds no
data. There are no seed accounts; create one through the UI.

Combined setup after editing environment files:

```powershell
pnpm setup
```

The script runs install, Prisma generation and migration. It does not start
Raftline, Docker or the web server.

## 7. Run the application

```powershell
pnpm dev
```

Open `http://localhost:3000`.

Expected first-run flow:

1. Register a customer.
2. Complete onboarding and accept the INR wallet.
3. The dashboard auto-provisions the wallet.
4. The status changes from `Pending` or `Provisioning` to `Active`.
5. The available balance is read from Raftline and should be `₹0.00` for a new
   account.

If the wallet enters `Verification needed`, do not retry repeatedly. Check the
Raftline cluster, the leader, and the account existence as described in the
integration runbook.

## 8. Useful commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Next.js in development mode. |
| `pnpm build` | Create the production build. |
| `pnpm start` | Start the production build. |
| `pnpm lint` | Run the Next.js ESLint check. |
| `pnpm typecheck` | Type-check all workspace packages. |
| `pnpm test` | Run unit tests. |
| `pnpm test:integration` | Run live Raftline integration tests. |
| `pnpm test:e2e` | Run Playwright and start/reuse the dev server. |
| `pnpm db:generate` | Regenerate Prisma Client. |
| `pnpm db:migrate` | Apply migrations in development. |
| `pnpm db:deploy` | Apply committed migrations in a deployed environment. |
| `pnpm db:studio` | Open Prisma Studio. |
| `pnpm db:reset` | Drop and recreate the local schema. Destructive. |

## 9. Test prerequisites

### Unit tests

No external services are required:

```powershell
pnpm test
```

### Integration tests

Require the live Raftline cluster:

```powershell
pnpm test:integration
```

The suite uses tenant `nexuspay-test` and deletes its test account through the
current leader. It does not require PostgreSQL or the web server.

### End-to-end tests

Require:

- PostgreSQL running and migrated.
- Raftline running with an elected leader.
- `apps/web/.env.local` configured.
- Port `3000` free or an existing Nexus Pay dev server running.

Run:

```powershell
pnpm test:e2e
```

Playwright starts or reuses `pnpm --filter @nexus/web dev`, waits for
`http://localhost:3000`, creates a unique `e2e.*@example.test` user, provisions a
wallet, updates the profile, signs in again, resets the password and signs in with
the new password.

Global teardown deletes test users, audit rows and their Raftline accounts. Test
cleanup matches only local emails that start with `e2e.` and end with
`@example.test`. Do not point integration tests at a production tenant.

## 10. Production checklist

- Set `NODE_ENV=production`.
- Set `PASSWORD_RESET_DEV_MODE=false`.
- Use HTTPS for `APP_URL`.
- Generate `AUTH_SECRET` from a cryptographically secure source and store it in a
  secrets manager.
- Use a dedicated PostgreSQL role with least privilege.
- Run `pnpm db:deploy`, not `pnpm db:reset`.
- Configure SMTP if password reset email is required.
- Configure `RAFTLINE_API_KEY` if Raftline requires authentication.
- Replace the process-local rate limiter with a shared store before scaling
  horizontally.
- Centralize logs and monitor for `RECONCILIATION_REQUIRED` wallets.
- Back up PostgreSQL before migrations.
- Restrict network access to PostgreSQL and Raftline.
- Never expose the Raftline KV endpoint to browsers.
- Serve behind a reverse proxy that preserves the correct client IP headers.

## 11. Troubleshooting

### `DATABASE_URL` cannot be found

Prisma CLI commands run in `packages/database` and load
`packages/database/.env`. The web app loads `apps/web/.env.local`. Both need a
database URL. Restart the dev server after environment changes.

### Prisma reports `P1001`

PostgreSQL is not reachable. Check:

```powershell
docker compose ps
docker exec nexuspay-postgres pg_isready -U nexuspay -d nexus_pay
```

Also check that no local PostgreSQL instance already owns port `5433`.

### Prisma reports `P2021` or the migration is missing

Apply migrations:

```powershell
pnpm db:generate
pnpm db:migrate
```

For a deployed database, use `pnpm db:deploy`.

### Wallet stays in `Pending` or `Provisioning`

- Confirm the Raftline cluster has an elected leader.
- Check that the web process can reach ports `8001`-`8005`.
- Inspect the wallet row and audit events.
- Do not create the account manually unless the provisioning state is understood.
- A `PROVISIONING` lease older than two minutes can be reclaimed by retrying.

### Wallet enters `Verification needed`

This means the result was ambiguous. Read the account from the current leader.
Do not loop the provision endpoint. Follow the reconciliation runbook in
`docs/raftline-integration.md`.

### `Cannot find package '@nexus/database'` in Playwright

Playwright's global teardown must import the workspace source by relative path:

```ts
import { prisma } from "../../packages/database/src/index";
```

Keep this import relative unless the root test workspace explicitly declares the
package as a dependency.

### CSRF error after opening the app

The CSRF cookie is issued by middleware on a GET request. Load or refresh a page
inside the app before submitting a form. If the error persists, clear the
`np_csrf` cookie and reload.

### Rate-limited during tests

The fixed-window limiter is in memory and can retain state across test runs.
Restart the Next.js process to clear it. Use unique E2E credentials rather than
reusing accounts.

### Mailpit has no reset email

- Check that `SMTP_HOST=localhost`.
- Check that the container is running: `docker compose ps`.
- Open `http://localhost:8025`.
- If SMTP is intentionally disabled, use `PASSWORD_RESET_DEV_MODE=true` and the
  link shown by the UI.

### Port `3000` already in use

Stop the conflicting process or use Playwright's `reuseExistingServer` behavior
only when the existing process is a compatible Nexus Pay dev server. Do not let
Playwright test an unrelated application.
