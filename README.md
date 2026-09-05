# UK Trade Leads Meta Ads Command Centre

Private internal dashboard for UK Trade Leads. It turns stored Meta acquisition data into a clear operator view without pretending that lead volume is the same as lead quality or customer value.

## What it shows

- Optional persisted AI daily briefing when an Anthropic key is configured. It explains stored deterministic evidence; the dashboard and recommendations remain available without AI.
- An explicit creative brief generator that uses stored headline, body, CTA, destination, format and media identifiers. Images and video are not inspected, so creative explanations are labelled hypotheses.
- Scorecard for spend, CPL, learning evidence, link CTR, CPM, launch age, and configured decision gates.
- Historical sparklines for CPL and CPM with matched-period comparisons.
- Creative leaderboard sorted by CPL, with evidence-aware verdicts, fatigue diagnostics, and an Ads Manager link.
- UKTL conversion path: impressions, link clicks, leads, contacted, qualified, call booked, call attended, and won customer. Lost is shown as a separate outcome.
- Explicit HighLevel CRM attribution state. Meta-reported leads, CRM contacts, qualified leads and customer outcomes remain separate; unmapped and unattributed records stay visible.
- A secret-free UKTL operating brief at `public/plan.md.template`, loaded by the operator brief panel when `public/plan.md` exists.
- Recorded action log entries. Meta write helpers remain disabled until the later approval-gated delivery stage.
- Deterministic recommendations computed after a successful sync, persisted with a versioned evidence snapshot, and read back by the authenticated dashboard. They remain suggestions: pause, scale and creative changes require the later approval-gated action stage.

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

When `ANTHROPIC_API_KEY` is configured, a complete warning-free sync makes a best-effort persisted summary snapshot. The authenticated insights `GET` routes read that snapshot; the dashboard never calls Anthropic during render. The summary and creative `POST` routes explicitly regenerate a snapshot from server-side stored data, ignore browser-supplied metrics, and leave the last valid snapshot intact when the provider or validation fails. Repeated automatic generation is deduplicated by a hash of the supplied evidence; an older snapshot is marked stale after the stored data changes.

AI output is schema-validated and every displayed claim must reference an evidence ID from the same stored context. The AI may explain or propose hypotheses, but it does not perform arithmetic, infer lead quality/customer value, execute Meta changes, or turn recommendations into actions. The creative boundary is deliberately metadata-only: no image or video bytes are supplied or inspected.

Recommendation lifecycle rows are materialised only after a complete, warning-free successful sync. A warning-bearing or metadata-incomplete sync leaves the last complete recommendation set intact, so an incomplete observation cannot create contradictory active advice or resolve an older row. The dashboard only exposes validated active rows in the configured account/campaign/attribution scope; malformed evidence is omitted rather than treated as empty data.

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
- `META_RECOMMENDATION_COMPARISON_DAYS` - recommendation comparison window: `3`, `7`, `14` or `30`; defaults to `7`.
- `META_GRAPH_VERSION` - Graph API version, defaulting to `v25.0`.
- `META_CAMPAIGN_LAUNCH_DATE` - `YYYY-MM-DD`, used for account-local phase context.
- `ANTHROPIC_API_KEY` - enables the optional persisted AI briefing and creative brief features.
- `ANTHROPIC_MODEL` - optional Anthropic model identifier; the application uses its dated default when omitted.

HighLevel CRM attribution is optional and read-only:

- `HIGHLEVEL_TOKEN` - server-side HighLevel Private Integration Token with the least-privilege contact-read and `opportunities.readonly` scopes. The current contact-search reference does not publish a complete scope contract, so confirm the exact contact read permission against the live account before enabling polling.
- `HIGHLEVEL_LOCATION_ID` and `HIGHLEVEL_PIPELINE_ID` - the confirmed UKTL sub-account and opportunity pipeline.
- `HIGHLEVEL_STAGE_LEAD_ID`, `HIGHLEVEL_STAGE_CONTACTED_ID`, `HIGHLEVEL_STAGE_QUALIFIED_ID`, `HIGHLEVEL_STAGE_CALL_BOOKED_ID`, and `HIGHLEVEL_STAGE_CALL_ATTENDED_ID` - explicit pipeline stage IDs. The application never infers stages from names or order.
- `HIGHLEVEL_WON_STATUS` and `HIGHLEVEL_LOST_STATUS` - exact provider status values for terminal outcomes.
- `HIGHLEVEL_META_AD_ID_FIELD_ID` and `HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID` - optional explicit custom-field IDs used to attribute a CRM contact to a Meta ad or campaign. Provider-marked `meta`/`facebook` ad or campaign IDs are also accepted; UTM campaign names are not treated as Meta IDs.
- `HIGHLEVEL_CURRENCY_CODE` - explicit currency used to interpret opportunity values. Revenue and ROAS stay unknown or incomplete when it is absent, mismatched with Meta, or values are missing.
- `HIGHLEVEL_SYNC_ENABLED` - an explicit `true` gate before any HighLevel provider call. It defaults to `false`; no live access is currently configured.
- `HIGHLEVEL_SYNC_LEASE_SECONDS` and `HIGHLEVEL_MAX_RECORDS` - bounded polling lease and record cap.

The adapter uses the current HighLevel v3 read contracts: [Search Contacts](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced), [Search Opportunity](https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity), and [Get Pipeline](https://marketplace.gohighlevel.com/docs/ghl/opportunities/get-pipeline/). Contacts are queried with a bounded page body because the current contact-search reference does not publish a complete response schema; live validation must confirm the account's response shape before enabling the cron. The scheduled route is `/api/cron/sync-highlevel` at 06:30 UTC, protected by `CRON_SECRET`. Each run is recoverable: it records an audit row, uses a location/pipeline lease, writes only normalized fields, preserves the last successful snapshot on failure, and never deletes records.

CRM dashboard metrics use a 30-day contact-created cohort in the account timezone. Rates use distinct CRM contacts and the best mapped opportunity snapshot for each contact; Meta leads remain a separate reported count. Revenue/ROAS is shown only when the configured HighLevel currency matches the Meta account currency and all relevant won values are known. Attribution labels are `Meta ad`, `Meta campaign`, `Paid Meta`, and `Unattributed`. The normalized snapshot stores provider IDs and bounded attribution metadata only; raw contact email, name, phone and full provider payloads are never stored.

Targets and budgets are not environment defaults. They live in the typed UKTL configuration and remain `null` until supplied as an approved business input. Currency and timezone come from the Meta account and are formatted with `en-GB` rules.

## Production deploy

Use a private Vercel project and a production libSQL/Turso database. With the production `DATABASE_URL` configured, apply all committed migrations before serving the app:

```bash
npx prisma migrate deploy
```

Set the environment values from `.env.example` in Vercel. Keep all tokens server-side. Configure the Vercel cron to call `/api/cron/sync-meta` with the bearer value represented by `CRON_SECRET`; when the HighLevel read-only gate is configured, enable `/api/cron/sync-highlevel` with the same protected bearer and verify both responses are successful stored syncs before treating the deployment as live. HighLevel remains safely disabled when its explicit gate is false or its mapping/token is incomplete.

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
app/api/cron/sync-highlevel    protected read-only HighLevel polling
lib/meta.ts                    Meta read client and diagnostics
lib/sync.ts                    transactional sync and leases
lib/read-model.ts              database-backed dashboard state
lib/recommendations.ts         pure evidence analysis and deterministic rules
lib/recommendation-store.ts    validated persistence and lifecycle reads
lib/ai-briefings.ts            evidence context, schemas, prompts and grounding
lib/ai-briefing-store.ts       scoped durable AI snapshot persistence/readback
lib/highlevel.ts               bounded HighLevel v3 read client
lib/highlevel-sync.ts          recoverable read-only CRM snapshot polling
lib/crm-attribution.ts         explicit attribution and stage normalisation
lib/crm-metrics.ts             deterministic CRM funnel, cost and revenue metrics
lib/ai-service.ts              optional Anthropic generation and fail-closed errors
lib/uktl-config.ts             typed UKTL domain configuration
lib/targets.ts                 target classification without defaults
lib/format.ts                  account-currency and UK date formatting
public/plan.md.template        secret-free operating brief template
prisma/schema.prisma           durable read model plus AI snapshots and legacy tables
```

Run the full local gate suite with:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
