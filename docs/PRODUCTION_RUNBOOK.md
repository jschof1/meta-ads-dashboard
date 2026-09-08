# Production verification and recovery runbook

Status (2026-09-08): deployed on Cloudflare Workers with a Turso Free database
in Ireland. Live login, protected API boundaries, database access and all seven
migration checks passed. See [Cloudflare deployment](./CLOUDFLARE_DEPLOYMENT.md).
Meta credentials and matching-date reconciliation remain outstanding; optional
HighLevel mapping/token and AI are not configured. Meta writes remain disabled.

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

## Controlled production deployment and database changes

1. Create or select the authenticated Cloudflare Worker and the production Turso
   database. Confirm the database name and URL from the provider account; do
   not paste credentials into the repository.
2. Take and retain a recoverable database backup before the first schema change.
3. Set server-only Cloudflare Worker secrets. At minimum:
   `DASHBOARD_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`, `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `META_MARKETING_TOKEN`, and `META_AD_ACCOUNT_ID`.
   Production requires TLS (`libsql://` or `https://`, never `tls=0`); invalid
   or missing configuration fails closed without a local-file fallback.
   The repository's install/build wrappers supply a local SQLite datasource
   URL to `prisma generate`; no production `DATABASE_URL` is required for the
   Cloudflare build. The runtime selects `TURSO_DATABASE_URL` first and the Worker
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
   Worker request.
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
6. Deploy the merged `main` commit with `npm run deploy:cloudflare`. Verify the deployment build and
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

The committed `wrangler.jsonc` schedules Meta at `0 6 * * *` and HighLevel at
`30 6 * * *`, both UTC. `cloudflare-worker.mjs` dispatches the existing protected
route through the OpenNext fetch handler, supplying `CRON_SECRET` as a bearer
header. Disabled HighLevel polling is skipped. Changes require a new deployment.
Use Cloudflare Worker logs to inspect actual scheduled events. Registration alone
is not a successful sync. The normal Node.js route endpoints remain available
for authenticated operator smoke checks.

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

- **Hosting and storage:** provisioned and verified on Cloudflare Workers and
  Turso Free. Live database/auth/migration diagnostics passed on 2026-09-08.
  See the Cloudflare deployment record for identifiers and repeatable commands.
- **Meta reads:** connected on 2026-09-08 to UK Trade Leads | AG Digital Studio.
  Graph v26, GBP/Europe-London, website Lead pixel event and 7d-click/1d-view
  attribution are configured. The initial 90-day sync stored 1,330 rows;
  closed-day spend, impressions, link clicks and leads matched Meta directly.
  Some daily rows omit lead results, so period lead/CPL totals remain unknown
  and the sync shows a data warning. See the Cloudflare deployment record.
  Renew the read-only system-user token before 2026-11-07.
- **CRM:** confirm the business pipeline and semantic stages described above,
  then configure an application-specific read-only integration token. Contact
  and opportunity API contract checks do not prove the chosen funnel mapping.
- **Meta mutations:** remain disabled. No live mutation was attempted. This
  requires a separate explicit approval, suitable permissions and budget bounds.
- **Production acceptance:** deployed authentication and migration state passed; successful live
  actual scheduled-provider results and CRM integration remain open. The initial Meta sync and closed-day reconciliation passed. Local/CI checks do not replace those observations.

GitHub issues are disabled for this repository, so the implementation PR and
this runbook hold the remaining release-gate record.

## Secret rotation

Rotate each value at its provider first, then replace the matching Cloudflare Worker secret and redeploy:

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


### 8 September 2026: private integration compatibility and funnel evidence

The existing UKTL private integration supports `Version: 2021-07-28`. Using
`v3` with this token returns 401 for contact search, despite valid location and
pipeline reads. The dated API requires `location_id` and `pipeline_id` query
parameters for opportunity search; the v3 client uses camelCase. Both contracts
are supported explicitly. A live application-client read retrieved all 2,636
contacts and 312 opportunities, matching provider totals without truncation.

The business funnel is not represented by five distinct pipeline stages:
`contacted` is a contact tag; booking history comes from the website sales
calendar `yqmEqEfPBSYpEBnQ91Q3`; Stripe confirms payments. Closed is only a sales
indicator. Do not fabricate stage IDs to enable the existing stage-based sync.
Calendar reads from November 2025 through 8 September 2026 returned 203 events
for 178 contacts. Confirmed bookings do not prove attendance. The qualification
rule remains unconfirmed and must be unavailable until supported by evidence.

Stripe-to-CRM reconciliation is a private operator analysis, not a deployed
scheduled Stripe integration. All 18 successful payments in the inspected
10 August–8 September window have client matches after owner clarification.
The dashboard still needs durable tag, appointment and payment ingestion before
it can report these outcomes automatically. Keep date cohorts and attribution
coverage explicit; historical first-touch campaign revenue is not same-period
ROAS.
