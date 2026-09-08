# Cloudflare deployment

Cloudflare Workers replaces the original Vercel plan under Jack's 2026-09-08
instruction. No Vercel account or project is required.

## Live resources

- App: https://uktl-meta-dashboard.jackschofield1.workers.dev
- Cloudflare account: `1d7541992ccacf0931ee0e385daa5e08`
- Worker: `uktl-meta-dashboard`
- Verified deployment version: `1558053e-9f19-494b-949f-a80313869609`.
- Turso organization: `jschof1`, **Free** plan (confirmed in dashboard).
- Database: `uktl-meta-dashboard`, SQLite/libSQL, Ireland (`aws-eu-west-1`).
- Database ID: `01a08139-ff01-77b7-93ee-0b0135e9a00f`.
- Database schema: all seven committed migrations applied; the database was
  verified empty before initial migration. No existing data was replaced.

The existing Cloudflare account already had **Workers Paid ($5/month plus
usage)** before this deployment. No subscription was added or upgraded.
Included usage is shared with other Workers; this is not a guarantee of zero
incremental cost. The Worker has a 1,000 ms CPU ceiling per invocation. Cloudflare
also offers a Free plan, but its 10 ms CPU limit is not a reliable target for this
SSR/Prisma/sync workload. Do not downgrade the shared account to test this app.
Turso Free needs no payment card; stay within its provider quotas.

Sources checked 2026-09-08: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Turso pricing](https://turso.tech/pricing?frequency=monthly).

## Build and deploy

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build:cloudflare
npx wrangler deploy --dry-run
npm run deploy:cloudflare
```

OpenNext adapts the existing Next.js build. It preserves normal `next dev`,
`next start` and the existing Node.js tests. OpenNext currently labels Node.js
proxy support experimental; deployed authentication and protected paths are
therefore checked explicitly by `npm run test:cloudflare`.

`cloudflare-worker.mjs` wraps the generated fetch handler and exports the
scheduled handler. It replaces untrusted forwarding headers with Cloudflare's
client IP for durable login throttling. The Worker serves public `/_next/static/`
JavaScript and CSS through the ASSETS binding. Other paths go through Next, so `/plan.md` cannot bypass authentication through the static asset service.
Prisma clients are scoped to each Cloudflare request because Workers cannot reuse
request-owned database I/O in later requests. Local Node operation retains a shared client.
No shared page-cache bucket or additional paid service is provisioned.

`wrangler.jsonc` is the source of truth for account, Worker, bindings and crons.
`vercel.json` was removed. GitHub CI validates the Cloudflare build and dry run;
deployment is an explicit Wrangler command, not an automatic GitHub push hook.

## Secrets and owner login

Cloudflare Worker secrets contain `DASHBOARD_PASSWORD`, `AUTH_SECRET`,
`CRON_SECRET`, `TURSO_DATABASE_URL` and a database-scoped `TURSO_AUTH_TOKEN`.
Values are absent from Git, logs and this document. Meta writes and HighLevel
polling remain disabled through explicit Worker variables.

On Jack's Mac, the owner-only file
`~/.config/uktl-meta-dashboard/login.txt` contains the dashboard URL/password.
`~/.config/uktl-meta-dashboard/production.json` is the owner-only credential
handover for migrations and secret updates. Both files have mode 0600. Do not
attach either to a PR, copy into public assets, or print the full configuration.
The Turso CLI stores its own operator login separately.

For rotation, generate/revoke the relevant value at its provider, replace the
Worker secret with `wrangler secret put KEY`, and verify the live app again.
Changing `AUTH_SECRET` invalidates existing dashboard sessions. Keep database
migrations operator-controlled and take a recoverable backup once data exists;
the detailed baseline/checksum/recovery procedures remain in
[PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md).

## Verification and outstanding data connections

Live HTTP checks on 2026-09-08 passed:

- Login page renders; signed-out dashboard and plan paths redirect to login.
- Protected data and cron endpoints return 401 without authentication.
- Correct login creates Secure, HttpOnly, SameSite=Strict cookies.
- Two separate sessions can read the dashboard and query database diagnostics.
- Database status is `ok`; migration status is `ok`, with seven applied.
- Logout clears the browser cookie.
- Meta is `not_configured`, and live mutation gating remains disabled.

Repeat with `DASHBOARD_SMOKE_URL` and `DASHBOARD_PASSWORD` supplied securely in
the environment, then run `npm run test:cloudflare`. This check never calls Meta
or changes advertising/CRM data.

Cloudflare schedules are registered at 06:00 UTC for Meta and 06:30 UTC for
HighLevel. Unit tests verify schedule dispatch, bearer protection, disabled CRM
skipping and failure propagation. Registration and manually invoking an HTTP
route are not evidence of an actual scheduled provider sync.

Meta reads connected on 2026-09-08 using the UKTL Ads Dashboard app
(`1139210748785458`) and a Work OS system-user token with `ads_read`.
The API confirms account `act_1357893439073996`, UK Trade Leads | AG Digital Studio,
GBP and Europe/London. The Business Suite asset ID is `6890136328739`;
use the API-confirmed account ID in application configuration.

Production uses Graph `v26.0` (the new app upgrades v25 requests to v26),
`META_PRIMARY_RESULT_ACTION_TYPE=offsite_conversion.fb_pixel_lead` (confirmed
against the ad set's LEAD pixel event), and `7d_click,1d_view` attribution.
No Meta write permission was requested and `META_WRITES_ENABLED=false`.

The initial 90-day sync succeeded for 2026-06-11 through 2026-09-08, storing
1,330 rows. A closed-day comparison for 2026-09-07 matched spend, impressions,
link clicks and website leads against a fresh Meta API read with identical
dates and attribution. The live browser renders account, campaign and ad data.

The sync retains a warning for 889 daily rows without a returned lead action.
Those values remain unknown, so some period lead/CPL totals remain unavailable.
This does not indicate an authentication failure. Daily imports are scheduled
at 06:00 UTC. The 60-day token expires on 2026-11-07 and must be renewed before
expiry. Credentials and detailed reconciliation are stored only in the
owner-only local configuration directory and Cloudflare secrets.
Without those, Meta sync fails safely and no zero-performance snapshot is
created. HighLevel needs its own confirmed pipeline/stages and runtime token;
Anthropic remains optional and unconfigured. Hosting and database setup are
complete independently of those provider-data acceptance checks.
