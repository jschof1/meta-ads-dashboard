# UK Trade Leads Meta Ads Command Centre

Private internal dashboard for UK Trade Leads. It turns stored Meta acquisition data into a clear operator view without pretending that lead volume is the same as lead quality or customer value.

## What it shows

- AI daily briefing when an Anthropic key is configured. The deterministic stored metrics remain available without AI.
- Scorecard for spend, CPL, learning evidence, link CTR, CPM, launch age, and configured decision gates.
- Historical sparklines for CPL and CPM with matched-period comparisons.
- Creative leaderboard sorted by CPL, with evidence-aware verdicts, fatigue diagnostics, and an Ads Manager link.
- UKTL conversion path: impressions, link clicks, leads, contacted, qualified, call booked, call attended, and won customer. Lost is shown as a separate outcome.
- Explicit CRM attribution state. Downstream counts stay unknown until a supported CRM integration supplies them.
- A secret-free UKTL operating brief at `public/plan.md.template`, loaded by the operator brief panel when `public/plan.md` exists.
- Recorded action log entries. Meta write helpers remain disabled until the later approval-gated delivery stage.

Budget projections and customer-value assumptions are intentionally absent. They are not inferred from acquisition data.

## Stack

Next.js 16.3 · React 19 · Tailwind 4 · shadcn · Recharts · Prisma with libSQL/local SQLite · Anthropic SDK · Vercel cron.

## Local install

```bash
git clone https://github.com/jschof1/meta-ads-dashboard
cd meta-ads-dashboard
npm ci
cp .env.example .env.local
# Fill in private values in .env.local
cp public/plan.md.template public/plan.md

DATABASE_URL="file:./dev.db" npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000` and sign in with `DASHBOARD_PASSWORD`.

To request a manual Meta sync after the server is running, sign in and use the authenticated `Sync now` dashboard control.

The first successful sync stores the initial historical window. Later runs refresh recent days so delayed results can be incorporated. A dashboard page load reads the durable database and does not call Meta.

## Environment

Required:

- `DASHBOARD_PASSWORD` - password for the private dashboard.
- `AUTH_SECRET` - at least 32 random characters for signed sessions.
- `CRON_SECRET` - at least 32 random characters for the protected cron endpoint.
- `DATABASE_URL` - libSQL connection string, or `file:./dev.db` locally.
- `META_MARKETING_TOKEN` - server-side Meta read token.
- `META_AD_ACCOUNT_ID` - Meta account ID, with or without the `act_` prefix.

Optional:

- `META_CAMPAIGN_ID` - restricts the stored view to one campaign.
- `META_CUSTOM_CONVERSION_ID` - private Meta result identifier when required by the account setup.
- `META_PRIMARY_RESULT_ACTION_TYPE` - explicit Meta result action when more than one candidate is returned.
- `META_ATTRIBUTION_WINDOWS` - comma-separated attribution windows, defaulting to `7d_click,1d_view`.
- `META_GRAPH_VERSION` - Graph API version, defaulting to `v25.0`.
- `META_CAMPAIGN_LAUNCH_DATE` - `YYYY-MM-DD`, used for account-local phase context.
- `ANTHROPIC_API_KEY` - enables the optional AI briefing and creative brief features.

Targets and budgets are not environment defaults. They live in the typed UKTL configuration and remain `null` until supplied as an approved business input. Currency and timezone come from the Meta account and are formatted with `en-GB` rules.

## Production deploy

Use a private Vercel project and a production libSQL/Turso database. Apply the committed migrations before serving the app:

```bash
turso db shell meta-ads-dashboard < prisma/migrations/20260904170000_pr03_sync_data/migration.sql
```

Set the environment values from `.env.example` in Vercel. Keep all tokens server-side. Configure the Vercel cron to call `/api/cron/sync-meta` with the bearer value represented by `CRON_SECRET`, then verify the response is a successful stored sync before treating the deployment as live.

For an existing database created with an earlier schema workflow, take a recoverable backup, apply the migration SQL once, and record the migration as applied with Prisma. Do not overwrite a production database to repair drift.

## Domain and evidence rules

`lib/uktl-config.ts` is the single-business UKTL configuration. It defines the funnel vocabulary, optional targets, evidence minimums, frequency diagnostics, locale, and the private operating brief. It intentionally does not define a target CPL, budget, CAC, or revenue value.

`lib/format.ts` formats minor units with the currency returned by Meta. If that currency is unavailable, the UI says `Currency pending`; it never silently applies a default currency.

Missing provider fields remain `null`, while a real zero remains `0`. Failed syncs preserve the last successful stored read model and expose a redacted diagnostic state.

`META_WRITES_ENABLED` must remain false. The later Meta-action delivery adds approval, authorization, audit, and fail-closed controls before any live mutation is considered.

## File map

```text
app/(dashboard)/page.tsx       authenticated operator surface
app/api/dashboard/state        durable read endpoint
app/api/cron/sync-meta         protected scheduled sync
lib/meta.ts                    Meta read client and diagnostics
lib/sync.ts                    transactional sync and leases
lib/read-model.ts              database-backed dashboard state
lib/uktl-config.ts             typed UKTL domain configuration
lib/targets.ts                 target classification without defaults
lib/format.ts                  account-currency and UK date formatting
public/plan.md.template        secret-free operating brief template
prisma/schema.prisma           durable read model plus retained legacy tables
```

Run the full local gate suite with:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
