# Meta Ads Dashboard

Private, opinionated dashboard for managing a Meta (Facebook + Instagram) ad campaign. Replaces Ads Manager for daily review. Layered with AI-generated daily briefings on top of live Meta data.

Part of the Meta Ads + Claude Code system. See [github.com/bosar-academy/cc-meta-ads-system](https://github.com/bosar-academy/cc-meta-ads-system) for the master install (all 9 components in one paste).

## What it shows

- **AI Daily Briefing** - one paragraph each morning: what happened yesterday, the trend, ads to watch, recommended action, on-track call. Powered by Anthropic.
- **Scorecard** - today's spend, MTD spend, 7d CPR with green/yellow/red bands, learning-phase progress, decision gate status.
- **Sparklines** - CPR (with target band), CPM, link CTR, registrations, frequency, spend.
- **Creative leaderboard** - your top ads ranked by CPR, with status, thumbnail, and direct link to Ads Manager.
- **Full funnel** - impressions → link clicks → registrations → (optional Airtable) calls booked → enrollments.
- **Inline campaign plan** - reads `public/plan.md` (you fill from `public/plan.md.template`).
- **Decision triggers** - reads `lib/targets.ts` for your CPR bands and decision gates.
- **Budget What-If Simulator** - project conversions at different daily budget levels using your current funnel metrics.
- **Action log** - if Claude Code makes any changes via the Meta API on your behalf, they log here.
- **Generate Next Creative Brief** - for winning ads, generates new angle variations.

## Stack

Next.js 16.2 · React 19 · Tailwind 4 · shadcn · recharts · Prisma + libsql (Turso or local SQLite) · Anthropic SDK · Vercel cron.

## Quick install (recommended)

Use the Gumroad install prompt to walk through the full setup interactively (Anthropic key, Meta token, ad account, targets, optional Airtable). See [INSTALL.md](./INSTALL.md).

## Manual install (advanced)

```bash
git clone https://github.com/bosar-academy/meta-ads-dashboard
cd meta-ads-dashboard
npm install
cp .env.example .env.local
# Fill in your values
cp public/plan.md.template public/plan.md
# Edit public/plan.md with your campaign details

# Local SQLite (default - no Turso needed for dev)
DATABASE_URL="file:./dev.db" npx prisma migrate deploy

npm run dev
# Visit http://localhost:3000
```

To populate data locally, trigger a sync:
```bash
curl -X POST http://localhost:3000/api/refresh
```

## Required env vars

See [`.env.example`](./.env.example) for the full list with comments.

**Required:**
- `DASHBOARD_PASSWORD` - login password
- `AUTH_SECRET` - at least 32 random characters for signed sessions
- `CRON_SECRET` - at least 32 random characters for the protected cron endpoint
- `DATABASE_URL` - libsql connection string (default `file:./dev.db` for local)
- `META_MARKETING_TOKEN` - System User token from [cc-meta-tracking-setup](https://github.com/bosar-academy/cc-meta-tracking-setup)
- `META_AD_ACCOUNT_ID` - format `act_XXXXXXXXX`

**Optional:**
- `META_CAMPAIGN_ID` - filter to a specific campaign (blank = full account rollup)
- `META_CUSTOM_CONVERSION_ID` - the conversion the dashboard counts as "registration"
- `META_GRAPH_VERSION` - Graph API version, defaulting to `v25.0`
- `META_PRIMARY_RESULT_ACTION_TYPE` - required when Meta returns more than one possible lead/result action
- `META_ATTRIBUTION_WINDOWS` - explicit comma-separated attribution windows, defaulting to `7d_click,1d_view`
- `META_CAMPAIGN_LAUNCH_DATE` - YYYY-MM-DD; powers "days since launch" + learning-phase status
- `ANTHROPIC_API_KEY` - enables the optional AI Daily Briefing and creative brief features
- `AIRTABLE_ENABLED` + `AIRTABLE_*` - if you track sales pipeline in Airtable, enable for deeper funnel attribution

## Production deploy (Vercel + Turso)

```bash
# 1. Provision Turso DB
turso db create meta-ads-dashboard
turso db tokens create meta-ads-dashboard
# Capture URL + token

# 2. Apply the committed SQL migration to Turso.
# Prisma Migrate does not deploy directly to a remote libSQL/Turso database.
turso db shell meta-ads-dashboard < prisma/migrations/20260904170000_pr03_sync_data/migration.sql

# 3. Push code to GitHub (your own repo)
git remote add origin git@github.com:YOU/YOUR-REPO.git
git push -u origin main

# 4. Import to Vercel
# - Set the env vars from .env.example
# - Set DATABASE_URL = TURSO_DATABASE_URL
# - Set CRON_SECRET to a random string
# - Deploy

# 5. Verify
curl https://<your-vercel-url>/api/cron/sync-meta -H "Authorization: Bearer $CRON_SECRET"
# Expected after a successful sync: { "ok": true, "status": "SUCCEEDED", ... }
```

## File map

```
app/
  (public)/login/      # password gate
  (dashboard)/page.tsx # main dashboard - client fetches /api/dashboard/state
  api/
    auth/              # password verification
    cron/sync-meta/    # pulls Meta + (optional) Airtable, writes to Turso
    dashboard/state/   # read endpoint
    insights/summary/  # Anthropic-generated daily briefing (1h cache)
    refresh/           # on-demand sync trigger from the UI
lib/
  meta.ts              # Graph API client (insights, ad metadata)
  airtable.ts          # OPTIONAL - sales pipeline integration
  targets.ts           # CPR bands, CAC range, decision gates (EDIT FOR YOUR CAMPAIGN)
  plan-context.ts      # reads public/plan.md
  funnel.ts            # funnel building + attribution
  schema.prisma        # legacy tables plus Campaign, AdSet, Ad, Creative, DailyInsight, SyncRun
public/
  plan.md.template     # campaign brief template - copy to public/plan.md and fill in
```

## Customizing for your campaign

The two files you edit per campaign:

1. **`public/plan.md`** (copy from `public/plan.md.template`) - your campaign brief
2. **`lib/targets.ts`** - your CPR bands, CAC range, decision gates

Both are gitignored or marked as user-editable. The default targets in `lib/targets.ts` are placeholders for a typical $50/day cold lead-gen campaign - replace with your actual unit economics.

## Data and safety notes

- `/api/dashboard/state` reads only the durable database read model. It does not call Meta during page loads.
- The first sync requests an inclusive 90-day history; later runs refresh the most recent seven days to capture delayed conversions.
- Sync runs are account-scoped, idempotent and lease-protected. A failed run leaves the last successful data available and marks the dashboard stale/failed.
- Missing provider metrics remain unavailable (`null`), distinct from a reported zero. Result/action configuration is reported as a warning instead of inventing leads.
- Meta write helpers are approval-gated and disabled by default. `META_WRITES_ENABLED` must not be enabled without the explicit PR09 safety gate.
- For a database created previously with `prisma db push`, apply the committed migration SQL once, then mark that migration applied in the local migration ledger with `prisma migrate resolve --applied 20260904170000_pr03_sync_data`. Preserve a backup before changing a production database.

## Pairs with

- [`cc-meta-tracking-setup`](https://github.com/bosar-academy/cc-meta-tracking-setup) - sets up the pixel + custom conversion + token this dashboard reads
- [`cc-meta-ads`](https://github.com/bosar-academy/cc-meta-ads) - the Claude Code skill that creates the campaigns this dashboard tracks
- [`cc-ad-strategy`](https://github.com/bosar-academy/cc-ad-strategy) - the skill that produces the campaign brief you paste into `public/plan.md`
