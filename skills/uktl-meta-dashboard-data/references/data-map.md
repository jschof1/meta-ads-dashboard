# Data map and analysis notes

## Sources and flow

| Source | Where it lives | What it provides | Current cadence / limit |
| --- | --- | --- | --- |
| Meta Marketing API | Upstream provider | Ad account, campaign, ad set, ad, creative, daily insights | Worker cron at 06:00 UTC; verify the latest `SyncRun` and direct Meta reporting for fresh claims |
| HighLevel | Upstream provider | Contacts, configured form submissions, conversations, sales-calendar events | Saved register import at minute 45 hourly; subject to provider quota |
| Turso/libSQL | Production database | Durable read models and saved register | Saved data only; the timestamp determines freshness |
| Cloudflare Worker | App, API and scheduler | Authenticated dashboard and sync routes | Hosting/schedule, not the production database |

Production runtime selects `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; the Prisma datasource's SQLite URL describes local development. `wrangler.jsonc` supplies `HIGHLEVEL_LEAD_FORM_ID` and cron schedules. The owner config supplies location, pipeline, sales-calendar, Meta account and provider tokens. Verify configuration keys without displaying values. The stage-based `HIGHLEVEL_SYNC_ENABLED` gate is currently false; it does **not** disable the saved enquiry register's separate hourly import. The Meta write gate is currently false.

## Main tables

Check `prisma/schema.prisma` before writing SQL; migrations can change columns.

- `LeadRegisterSnapshot`: one row per HighLevel location, with `payload` JSON and `checkedAt`. `payload.entries` holds bounded names, tags, provider IDs, form receipts, appointment statuses and per-contact `checkedAt`. Phone, email and message bodies stay in HighLevel. The register merges older entries, so lifetime row count is not a recent lead count.
- `SyncRun`: Meta fetch status, scope, attribution key, requested dates, row counts, warnings and errors. Use latest **successful** run and inspect newer failures separately.
- `DailyInsight`: one row per date, level (`account`, `campaign`, `adset`, `ad`), entity ID, attribution key, and scope key. `spendMinorUnits`, `leads`, clicks, etc. are nullable: null means unavailable, zero means an observed zero. Use `level='account'` for an account total; summing all levels quadruple-counts. Do not mix attribution keys or scoped and account-wide rows.
- `Campaign`, `AdSet`, `Ad`, `Creative`: provider metadata keyed by Meta ID, with last-seen sync run. Metadata may be older than the insight rows.
- `CrmSyncRun`, `CrmContact`, `CrmOpportunity`: separate stage-based HighLevel read model. The gate is currently disabled, so these tables should not be treated as a current view. Check a successful run before use.
- `AdDaily` and `Snapshot`: older models; do not use for current reporting unless a task explicitly needs historical migration comparison.

## Common analysis joins and limits

- Match `DailyInsight` to `Campaign`/`AdSet`/`Ad` through `entityId = metaId` at the corresponding level. Group by date in the Meta account's reporting timezone; preserve `attributionKey` and `scopeKey` in comparisons. Join metadata only after checking the selected run and age.
- Filter a 30-day enquiry window by exact `contactCreated`, submission `at`, or appointment `at` timestamps relative to the register's `checkedAt`; those are different cohorts. Count contact IDs for people, submission IDs for receipts, event IDs for appointments. Do not add them together.
- The configured form ID comes from `wrangler.jsonc`, and the sales-calendar ID from owner config. The register may include form-attributed contacts whose receipt is absent from `/forms/submissions`. Other forms and calendars can contain activity but are outside configured-form/sales-calendar headline counts.
- Meta leads are provider action events. HighLevel contacts, configured form receipts, bookings, opportunities, and payments are separate populations. Do not infer conversion or revenue attribution without an actual person/event join and matching date scope.
- Contact follow-up questions require HighLevel conversation/message readback: direction, delivery status, reply, and date. Register tags and last-activity markers are triage hints.

## Read surfaces

The portable `scripts/dashboard.mjs` reads these saved surfaces with only the dashboard password. Use `status`, `ads`, `enquiries`, or `links` first. Advanced SQL helpers are Mac-specific and unnecessary for ordinary remote access. Do not use `GET /api/business-outcomes` as a cheap saved read: it calls HighLevel live.

- Authenticated dashboard: `https://uktl-meta-dashboard.jackschofield1.workers.dev/`.
- `GET /api/lead-register` returns the saved register; `POST /api/lead-register` performs a provider refresh and writes a new saved snapshot.
- `GET /api/diagnostics` and `GET /api/dashboard/state` provide authenticated status. Loading the dashboard does not itself call Meta.
- Protected `/api/cron/sync-leads` handles the hourly register import. `lib/cloudflare-scheduled.mjs` maps the three cron expressions to routes. An HTTP 200 or registered schedule alone is insufficient proof that the saved snapshot advanced.

For a broader analysis, use the scripts' aggregate output as the starting point, then write task-specific read-only SQL or provider queries. Minimise personal data in outputs. Record query dates, source timestamps, attribution settings, missing fields, and whether a current provider comparison was possible. Do not treat a failed or partial provider request as a valid zero.
