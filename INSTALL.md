# UK Trade Leads Meta Ads Command Centre

Private, single-business operator software for UK Trade Leads. It stores Meta
acquisition data, produces deterministic evidence and recommendations, and
keeps HighLevel outcomes separate until they are actually evidenced. It is
not a multi-client SaaS, client portal, CRM replacement, or generic Ads
Manager clone.

## Prerequisites

- Node.js 20 or newer and npm.
- A private Meta Business/ad account and a server-side read token for live
  ingestion. Local tests use fixtures and do not need Meta credentials.
- A private libSQL/Turso database for production. Local development uses
  SQLite.
- A Vercel project only for deployment. Anthropic and HighLevel are optional.

## Local setup

```bash
git clone https://github.com/jschof1/meta-ads-dashboard
cd meta-ads-dashboard
npm ci
cp .env.example .env.local
cp public/plan.md.template public/plan.md
```

Fill `.env.local` with a strong private dashboard password, unique
`AUTH_SECRET` and `CRON_SECRET` values of at least 32 characters, and local
database/Meta values. `DATABASE_URL=file:./dev.db` is the local default.
Never commit `.env.local` or put credentials in `public/plan.md`.

Apply the committed local schema and start the app:

```bash
DATABASE_URL="file:$PWD/dev.db" npx prisma migrate deploy
npm run dev
```

Run this from the repository root. Prisma CLI does not load `.env.local` and
resolves relative SQLite paths from its schema directory. The explicit absolute
URL targets the same root-level `dev.db` used by the runtime adapter. If you use
a different local database, supply that same absolute URL to both commands.

Open `http://localhost:3000`, sign in, and use `Sync now` only after the Meta
read configuration is complete. A page load reads the database and does not
call Meta. The first successful sync stores the initial historical window;
later runs refresh recent days so delayed results can be incorporated.

## Configuration contract

Required for a normal configured environment:

- `DASHBOARD_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`.
- `DATABASE_URL` locally, or `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` for
  the remote libSQL runtime.
- `META_MARKETING_TOKEN` and `META_AD_ACCOUNT_ID` for Meta reads.

Useful Meta values are `META_CAMPAIGN_ID`,
`META_ATTRIBUTION_WINDOWS` (default `7d_click,1d_view`),
`META_PRIMARY_RESULT_ACTION_TYPE`, `META_CUSTOM_CONVERSION_ID`,
`META_GRAPH_VERSION` (default `v25.0`), and
`META_CAMPAIGN_LAUNCH_DATE`. The account currency and timezone come from the
successful Meta sync; the UI uses `en-GB` formatting and says `Currency pending`
when Meta has not supplied a currency.

Targets and budgets are typed UKTL configuration inputs, not environment
defaults. They remain `null` until Jack supplies an approved business value.
The app never invents CPL, CAC, budget, revenue, or ROAS assumptions.

## Meta result setup

The sync records the result action types returned by Meta and does not assume
that every account's lead event is called `lead`, `registration`, or `complete
registration`. After configuring a read token, use the authenticated
`/api/meta/diagnostic` endpoint in a controlled operator session. Inspect the
redacted action-type diagnostics and set `META_PRIMARY_RESULT_ACTION_TYPE`
only when the account's real lead result is known. If the result is ambiguous,
leave the lead count unknown and resolve the mapping in Meta rather than
guessing.

## Optional AI and HighLevel

`ANTHROPIC_API_KEY` enables persisted AI explanations and metadata-only
creative briefs. AI reads server-side stored evidence, is schema-validated,
and cannot execute Meta actions. Without the key, deterministic metrics and
recommendations continue to work.

HighLevel is read-only and disabled by default. Enable it only when the
private token, UKTL location, pipeline, every explicit stage ID,
`HIGHLEVEL_WON_STATUS` and `HIGHLEVEL_LOST_STATUS` are
confirmed. Then set `HIGHLEVEL_SYNC_ENABLED=true`. The cron preserves the last
successful CRM snapshot on failure and stores bounded normalized attribution,
not contact PII or full provider payloads. An HTTP success does not prove the
mapping is right; sample provider IDs and stages during live validation.
Set `HIGHLEVEL_CURRENCY_CODE` separately to enable monetary results; complete
funnel counts remain usable without a currency mapping.

## Syncs, diagnostics, and failure visibility

- Meta manual sync: authenticated `POST /api/refresh` or the dashboard
  control.
- Meta cron: Vercel `GET /api/cron/sync-meta` (the route also accepts POST for
  local/manual checks).
- HighLevel cron: Vercel `GET /api/cron/sync-highlevel` (the route also accepts
  POST for local/manual checks).
- Authenticated system diagnostics: `GET /api/diagnostics`.
- Authenticated live Meta read diagnostic: `GET /api/meta/diagnostic`.

The dashboard reads stored `SyncRun`/`DailyInsight` data. Missing fields stay
`null`, real zeroes stay zero, and a failed/stale provider run does not erase
or fabricate the last successful read model. The diagnostics panel reports
database reachability, migration state, configuration presence, stored sync
freshness, optional provider state, and the Meta action gate without secrets.

Vercel cron schedules are configured for 06:00 UTC for Meta and 06:30 UTC for
HighLevel. Vercel sends the configured `CRON_SECRET` as the cron request's
bearer authorization header; do not put the secret in a URL. On Vercel Hobby,
daily jobs may run at any point within their scheduled hour, so verify the
actual invocation in Vercel logs. Cron configuration changes require a new
deployment.

## Approval-gated Meta actions

`META_WRITES_ENABLED=false` is the safe default. The app can prepare and
persist a proposal, but execution returns disabled before constructing a
provider or making a network call. The supported allowlist is pause/resume ad
and measured ad-set daily-budget increases. Each action requires a stored
recommendation, an authenticated operator, separate approval, live-state
verification, one bounded provider POST, read-after-write verification, and a
durable audit row.

Do not enable live writes during an ordinary deployment or browser smoke test.
Live mutation validation requires Jack's explicit approval, suitable Meta
advertiser permissions, server-only token configuration, and both
`META_ACTION_MAX_DAILY_BUDGET_MINOR` and
`META_ACTION_MAX_BUDGET_CHANGE_PERCENT`. Provider failures are terminal and
are never automatically retried.

## Production: Vercel and Turso

Create a private Vercel project and a production Turso database. The Turso
CLI's normal provisioning shape is:

```bash
turso db create <database-name>
turso db show <database-name> --url
turso db tokens create <database-name>
```

Store the returned URL/token in Vercel Production as
`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`. Set the auth, Meta, and optional
provider values server-side. `DATABASE_URL` is the local Prisma SQLite URL;
the application selects `TURSO_DATABASE_URL` first at runtime. The repository's
install/build wrappers supply a local SQLite schema URL to Prisma Client
generation, so Vercel does not need a production `DATABASE_URL`; Vercel's
filesystem must not be used as application storage.

Remote Turso/libSQL uses HTTP and must not be passed to Prisma Migrate. Prisma
documents that remote HTTP libSQL is incompatible with Prisma Migrate. After
taking a recoverable backup, apply the committed remote SQL with:

```bash
TURSO_DATABASE_URL='libsql://…' \
TURSO_AUTH_TOKEN='…' \
TURSO_MIGRATION_CONFIRM=yes \
npm run db:migrate:turso
```

The utility verifies migration checksums, writes the Prisma-compatible ledger,
applies each pending migration in an atomic non-interactive write batch, and is
idempotent. It refuses to guess a baseline for an existing table set with no
ledger. If the read-only inspector reports that such a legacy schema is
compatible with the selected committed migration version, record its ledger
only after an explicit review:

```bash
TURSO_DATABASE_URL='libsql://…' \
TURSO_AUTH_TOKEN='…' \
TURSO_MIGRATION_CONFIRM=yes \
TURSO_BASELINE_CONFIRM=yes \
npm run db:baseline:turso
```

The guarded baseline utility validates table SQL, columns, defaults,
constraints, indexes and foreign keys, then records only the migration ledger
in one atomic batch; it does not alter application tables or rows. Set
`TURSO_BASELINE_THROUGH` to an exact earlier migration name when the legacy
schema predates the current release, then run the normal migration command for
the remaining changes. Follow
[`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md) for the explicit
legacy-schema and recovery procedure. Do not use `prisma migrate reset` in
production. See the [Prisma Turso guide](https://docs.prisma.io/docs/orm/v6/overview/databases/turso)
and [Turso's Prisma guidance](https://docs.turso.tech/sdk/ts/orm/prisma).

Deploy only the merged `main` commit after migration. Sign in, verify
`/api/diagnostics`, verify a protected dashboard read, and confirm the Vercel
cron invocations create the expected durable sync rows. Record exact dates,
timezone, attribution window, action type, metrics and discrepancies when
manually reconciling against Meta Ads Manager. A production deployment is not
reconciled merely because it returned HTTP 200.

## UKTL data rules

The authoritative domain configuration is `lib/uktl-config.ts`. The funnel is
lead → contacted → qualified → call booked → call attended → won customer,
with lost shown separately. Meta-reported leads are not CRM contacts or
customers. Revenue/ROAS stays unknown unless opportunity values, currency and
attribution are all evidenced. Never turn missing provider data into a zero.

## Verification

Run the full local gate:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
npx playwright install chromium
npm run test:browser
```

The browser command tests the built app with `next start` against an isolated
official libSQL server over TLS, using a temporary JWT and a small synthetic
UKTL/GBP fixture. It verifies remote migrations, secure cookies, stored metrics,
diagnostics, approval UI, disabled Meta execution, and production rejection of
local-only storage. It requires macOS/Linux arm64/x64, OpenSSL, curl and tar;
the server download is checksum-pinned. Evidence is retained at the printed
temporary path, while the temporary database and runtime files are removed.
Keep live provider accounts out of routine smoke tests. The separate opt-in
`npm run validate:anthropic` command requires a secure key and
`ANTHROPIC_VALIDATION_CONFIRM=yes`; it performs a billable synthetic-data check.
