# Production verification and recovery runbook

Status: ready for controlled external validation. The repository has not been
connected to a production Vercel project, Turso database or Meta account from
this checkout as of 2026-09-06. Read-only HighLevel access and a synthetic live
Anthropic request have been validated; this is not a production deployment.

This is a single-business UK Trade Leads application. A local green build is
evidence about the code and fixtures, not proof that a provider account,
production database, domain, or scheduled job is live.

## Local evidence completed

The following checks are automated in this repository:

- All committed Prisma migrations apply to a fresh SQLite database, upgrade
  populated legacy rows without dropping them, and reject incompatible legacy
  schemas.
- `scripts/apply-turso-migrations.mjs` applies the same committed SQL through
  libSQL/Turso, records checksums in `_prisma_migrations`, is idempotent, and
  refuses to guess a baseline when application tables exist without a ledger.
- `scripts/record-turso-baseline.mjs` provides the controlled legacy path: it
  compares the remote schema's table SQL, columns, defaults, constraints,
  indexes, and foreign keys with a fresh application of the committed
  migrations through the selected version, then records only the checksum
  ledger in one atomic write batch. Views, triggers, index SQL/collation/order
  and schema changes racing the inspection are rejected. SQL comparisons are
  intentionally conservative: even formatting-only differences need review.
- Authenticated page/API access and cron bearer protection are covered by route
  tests. Login attempts are HMAC-keyed and atomically rate-limited in the
  durable database across function instances. The dashboard and static
  operating brief remain behind the auth boundary.
- Manual Meta sync, scheduled Meta sync, Meta diagnostic, AI provider failure,
  HighLevel disabled/provider failure, and malformed stored-data paths preserve
  the last known-good state and expose safe failure messages.
- Capped, duplicate, skipped or missing HighLevel rows fail the sync before
  replacing its last complete snapshot. Incomplete legacy CRM snapshots
  have their aggregates withheld, including funnel counts, rates, costs and
  revenue. Known revenue-only uncertainty withholds money/ROAS without hiding
  otherwise complete CRM counts. Missing is not zero.
- Meta and HighLevel snapshot writes use one atomic server-side libSQL batch,
  including the lease check and successful-run transition. Existing row IDs
  and creation dates survive updates. `npm run test:remote-sync` exercises
  3,000 synthetic contacts and 1,000 opportunities over real HTTPS/libSQL,
  repeat-sync identity preservation, incomplete-read preservation, mid-batch
  failure rollback and expired-lease rollback. Recommendation lifecycle
  persistence uses the same server-side batch approach and is exercised with
  2,000 synthetic candidates, including repeat observations and resolution.
  `RecommendationScopeState` records whole-set observations, including empty
  ones, so a delayed older analysis cannot reintroduce obsolete advice.
  No provider data is involved.
- Dashboard reads verify successful-run revisions before and after loading
  the stored data. A concurrent replacement triggers a bounded retry; ongoing
  churn fails closed. CRM row counts must also match the committed run, so
  superseded or incomplete snapshots cannot appear as complete zero outcomes.
- `/api/diagnostics` reports database reachability, migration state, stored Meta
  freshness, action-gate state, optional AI state, and optional HighLevel state
  without returning secrets or raw provider payloads.
- Browser smoke coverage verifies login, seeded durable-state rendering,
  diagnostics visibility, UK formatting, approval UI, and disabled Meta
  execution using `next start`, not the development server. It downloads a
  checksum-pinned official sqld binary into temporary storage, applies remote
  migrations over TLS with a temporary JWT, and verifies Secure/HttpOnly
  cookies, plus a 390px mobile viewport without horizontal overflow. The built
  app is also restarted without Turso to prove login,
  dashboard reads and cron fail closed without creating a local database.
  Run `npm run build` then `npm run test:browser` after installing the matching
  Chromium with `npx playwright install chromium`. macOS/Linux arm64/x64,
  OpenSSL, curl and tar are required. No live Meta endpoint is called. Evidence
  is retained in the printed temporary evidence directory; disposable DB,
  certificate, token and runtime files are removed.

## Controlled production deployment

1. Create or select the private Vercel project and the production Turso
   database. Confirm the database name and URL from the provider account; do
   not paste credentials into the repository.
2. Take and retain a recoverable database backup before the first schema change.
3. Set server-only Vercel environment variables for Production. At minimum:
   `DASHBOARD_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `META_MARKETING_TOKEN`, and `META_AD_ACCOUNT_ID`.
   Production requires TLS (`libsql://` or `https://`, never `tls=0`); invalid
   or missing configuration fails closed without a local-file fallback.
   The repository's install/build wrappers supply a local SQLite datasource
   URL to `prisma generate`; no production `DATABASE_URL` is required for the
   Vercel build. The runtime selects `TURSO_DATABASE_URL` first and Vercel's
   filesystem is not application storage.
   Keep `META_WRITES_ENABLED=false`. Add optional provider values only after
   their own validation gate is satisfied.
4. From the merged checkout, apply migrations with an operator-controlled
   command after the backup:

   ```bash
   TURSO_DATABASE_URL='libsql://…' \
   TURSO_AUTH_TOKEN='…' \
   TURSO_MIGRATION_CONFIRM=yes \
   npm run db:migrate:turso
   ```

   The command prints only migration names and never logs the URL, token, SQL
   failure payload, or provider response. It verifies the committed checksum
   for every already-applied migration before applying a pending one. Each
   pending migration is an atomic non-interactive write batch, so concurrent
   runs serialize at the database and a failed batch rolls back. Run it once
   from a controlled operator machine; do not run it from a request route or a
   Vercel function.
5. If the database already contains application tables but no
   `_prisma_migrations` ledger, stop. Take the backup, inspect the actual
   schema with the repository's read-only inspector. By default it compares
   with the latest migration. For an older schema, set the same exact
   `TURSO_BASELINE_THROUGH` value on this command and on the baseline command:

   ```bash
   TURSO_DATABASE_URL='libsql://…' \
   TURSO_AUTH_TOKEN='…' \
   npm run db:inspect:turso
   ```

   The inspector prints table SQL, column types/nullability/defaults, index
   definitions, foreign keys, and any existing ledger rows. It exits non-zero
   when the schema differs from the selected migration version. If it reports a
   compatible schema and the ledger is missing, record the baseline through the
   repository's guarded, ledger-only command after the explicit schema review.
   By default the command targets the latest migration. For an older but
   compatible legacy schema, set `TURSO_BASELINE_THROUGH` to the exact
   committed migration name; the normal migration command can then apply later
   migrations:

   ```bash
   TURSO_DATABASE_URL='libsql://…' \
   TURSO_AUTH_TOKEN='…' \
   TURSO_BASELINE_THROUGH='20260905143000_pr09_approved_meta_actions' \
   TURSO_MIGRATION_CONFIRM=yes \
   TURSO_BASELINE_CONFIRM=yes \
   npm run db:baseline:turso
   ```

   The command refuses an existing ledger, unexpected or incompatible tables,
   and local `file:` targets outside the test harness. It does not create,
   alter, or delete application tables or rows; it only creates the Prisma
   ledger and records every committed migration checksum in one atomic write
   batch. If the inspection reports a mismatch, do not baseline or repair it
   by deleting tables; resolve the schema difference through a separate,
   recoverable database change and rerun the inspection.
6. Deploy the merged `main` commit to Vercel. Verify the deployment build and
   then sign in through the private dashboard.
7. Open the authenticated dashboard and `/api/diagnostics`. Confirm database
   `ok`, migration `ok`, authentication and cron `configured`, and Meta
   `configured` only when the server-side read credentials are deliberately
   present. A missing or failed provider must be shown as not configured,
   failed, stale, or unknown; it must never appear as zero performance.

Prisma's current Turso guidance says remote HTTP libSQL is incompatible with
Prisma Migrate. This project therefore keeps Prisma's SQLite schema for local
generation/tests and uses committed SQL plus the libSQL client/Turso-supported
workflow for the remote database. See the [Prisma Turso guide](https://docs.prisma.io/docs/orm/v6/overview/databases/turso),
the [Turso Prisma guidance](https://docs.turso.tech/sdk/ts/orm/prisma), and
[Prisma production migration guidance](https://docs.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).

## Cron and manual sync verification

The committed `vercel.json` schedules:

- `/api/cron/sync-meta` at `06:00 UTC` (`0 6 * * *`).
- `/api/cron/sync-highlevel` at `06:30 UTC` (`30 6 * * *`).

Vercel makes a `GET` request and supplies `CRON_SECRET` as an
`Authorization: Bearer …` header when the environment variable is configured.
The configured expression is interpreted in UTC. On Vercel Hobby, a daily
job may run at any point within its scheduled hour; other plans have tighter
minute-level timing. A cron configuration change requires a new deployment.
Inspect the Vercel cron logs for the actual invocation. See Vercel's [current
cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Verify each route with the deployment's scheduler and inspect the stored
`SyncRun` or `CrmSyncRun` row. A successful HTTP response alone is not enough:
confirm the expected account/location scope, timestamps, row counts, and
warning state. An authenticated operator can use `Sync now` for Meta; a page
load never calls Meta.

If a sync fails, leave the last successful rows in place, inspect the safe
diagnostic and server log classification, correct the provider/configuration
issue, and run a new sync. Do not repair a failure by writing zero metrics.

## Manual Meta reconciliation

This has not been run against the production account from this checkout. When
the Meta read gate is available, record the following in the delivery ticket:

1. UTC timestamp, deployment commit, Graph version, account ID, and the exact
   `since`/`until` dates.
2. The same account timezone, attribution windows, result action type, and
   campaign scope in both Ads Manager and the dashboard.
3. A comparison of spend, impressions, clicks/link clicks, leads, and CPL for
   the identical dates. Distinguish a provider field that is absent from a
   real zero.
4. Any discrepancy, including delayed attribution or an ambiguous result
   action, with the safe sync trace ID. Do not call the numbers reconciled
   until the discrepancy is explained.

Meta writes remain disabled. Any future live write validation requires Jack's
explicit approval, a suitable advertiser token/account permission, an
operator window, and the configured absolute budget and percentage bounds.
Use mocks/fixtures for action tests; do not turn on the flag as part of a
deployment smoke test.

## AI and HighLevel validation

AI is optional. Without `ANTHROPIC_API_KEY`, the deterministic dashboard and
recommendations remain available and diagnostics report `not_configured`. With
the key present, verify that a complete stored sync produces a persisted,
schema-validated snapshot whose claims cite the same evidence IDs. A provider
failure must leave the last valid snapshot intact.

The opt-in `npm run validate:anthropic` check uses an isolated temporary database
and synthetic evidence, then validates and persists one real Anthropic summary.
It requires `ANTHROPIC_VALIDATION_CONFIRM=yes` and the key supplied through the
operator's secret helper or secure environment. It is billable, never runs in
CI, and logs only status/model/validation metadata, not provider content. On
2026-09-06 this passed with `claude-sonnet-4-5-20250929`. A first attempt exposed
the need for a 45-second bounded request timeout for structured-output
compilation/generation, within the 60-second route budget.

HighLevel is read-only and disabled unless the token, UKTL location, pipeline,
all stage IDs, terminal statuses, and explicit
`HIGHLEVEL_SYNC_ENABLED=true` gate are configured. Currency is optional for
complete funnel counts but required for monetary results. The existing Work OS OAuth
grant was used read-only on 2026-09-06 to discover the real UK Trade Leads
location, list its pipelines, and verify distinct pages of contact and
opportunity searches using `Version: v3`. No CRM records were changed or copied
into fixtures. The actual application client also fetched the complete reported
contact and opportunity collections with distinct IDs and no truncation. This
validates the pagination contract, not the unconfirmed business mapping.
The single-pipeline detail endpoint returned 401 for that grant;
the documented location-scoped pipeline list returned 200. The application now
uses that list and requires exactly one matching pipeline ID with the correct
location. See the [official pipeline-list contract](https://marketplace.gohighlevel.com/docs/ghl/opportunities/get-pipelines/).

The business mapping is still pending: several sales pipelines exist, and
contacted/qualified/attended meanings cannot be inferred from their stage names.
Do not copy a short-lived Work OS OAuth access token into deployment settings.
Use a suitably scoped, long-lived UKTL private integration for the application's
`HIGHLEVEL_TOKEN`, once the pipeline/stage choices are confirmed. Sample a small
set of returned provider IDs and
record location/pipeline scope, stage/status, created/updated dates, explicit
Meta ad/campaign IDs, currency, and dashboard classification. Do not record
contact names, emails, phone numbers, or full provider payloads. The sample
must prove that Meta leads, CRM contacts, qualified leads, booked calls, and
won customers are not being conflated.

## Remaining external release gates

- **Hosting and storage:** the connected Vercel team is accessible, but contains
  no project for this repository; the local Vercel CLI has no credentials. No
  production Turso URL/token is available in the secret helper or this checkout.
  Confirm/provision the intended Vercel project and Turso database, supply the
  database connection securely, then follow the controlled deployment steps.
- **Meta reads:** neither the secret helper nor the existing Work OS Meta
  integration has a configured marketing token/account. Supply only
  `META_MARKETING_TOKEN` (with read access) and `META_AD_ACCOUNT_ID` through the
  secret helper or Vercel server-side environment. Currency/timezone/entities
  and result action types should be discovered after connection. Reconcile
  identical dates/attribution before calling the performance numbers validated.
- **CRM:** confirm the business pipeline and semantic stages described above,
  then configure an application-specific read-only integration token. Contact
  and opportunity API contract checks do not prove the chosen funnel mapping.
- **Meta mutations:** remain disabled. No live mutation was attempted. This
  requires a separate explicit approval, suitable permissions and budget bounds.
- **Production acceptance:** deployed authentication, migration state, manual
  sync, actual cron invocations, provider reconciliation and recovery have not
  been claimed complete. Local/CI checks do not replace those observations.

GitHub issues are disabled for this repository, so the implementation PR and
this runbook hold the remaining release-gate record.

## Secret rotation

Rotate each value at its provider first, then replace the matching Vercel
Production environment variable and redeploy:

- `DASHBOARD_PASSWORD`: sign-in password.
- `AUTH_SECRET`: invalidates existing signed sessions.
- `CRON_SECRET`: immediately invalidates old scheduled/manual bearer values.
- `TURSO_AUTH_TOKEN`: issue a new database token and revoke the old one.
- `META_MARKETING_TOKEN`: issue/revoke the read or explicitly approved write
  token in Meta.
- `ANTHROPIC_API_KEY` and `HIGHLEVEL_TOKEN`: rotate only when those optional
  providers are enabled.

Never put a provider/database secret in a commit, migration, fixture, browser
request body, diagnostic response, or log. The dashboard sign-in password is
submitted only to its same-origin HTTPS authentication endpoint. After rotation, verify `/api/diagnostics`, a
protected dashboard request, and the cron bearer boundary.

## Recovery

- **Migration failure:** stop further deploys, retain the provider error only
  in the provider console, restore the recoverable backup if required, and
  inspect the migration ledger/checksum before retrying. Use Prisma's
  `migrate status`/`migrate resolve` only for a Prisma-managed local SQLite
  database; use the committed SQL and Turso ledger workflow for remote
  libSQL. Never use a production reset.
- **Meta sync failure:** preserve the last successful `SyncRun` and dashboard
  data, correct the token/scope/action type/date issue, and run a fresh sync.
- **AI failure:** preserve the last valid `AiBriefing`; deterministic metrics
  and recommendations remain authoritative.
- **HighLevel failure:** preserve the last successful CRM snapshot; keep
  attribution and revenue unknown where the evidence is incomplete.
- **Meta action failure:** treat the action as terminal. Do not retry the same
  POST automatically; inspect Meta and prepare a fresh proposal after
  confirming the live state. Keep the feature flag disabled unless the
  explicit safety gate is active.
