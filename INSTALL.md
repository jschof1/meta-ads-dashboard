# UK Trade Leads Meta Ads Command Centre

This is a private Next.js application for the UK Trade Leads operating team. It stores Meta acquisition data, reports it in the account currency and timezone, and keeps downstream CRM outcomes separate until they are evidenced.

## Before you start

You need:

- Node.js 20 or newer and npm.
- A Meta Business account and ad account.
- A server-side Meta read token with the required read permissions.
- A private database for production, such as libSQL/Turso.
- An Anthropic key only if the optional AI briefing is wanted.

The application is single-business by design. It has no tenant switcher, client portal, or admin panel.

## Local setup

```bash
git clone https://github.com/jschof1/meta-ads-dashboard
cd meta-ads-dashboard
npm ci
cp .env.example .env.local
cp public/plan.md.template public/plan.md
```

Set these values in `.env.local`:

1. `DASHBOARD_PASSWORD` - a strong private password.
2. `AUTH_SECRET` - a random value of at least 32 characters.
3. `CRON_SECRET` - a different random value of at least 32 characters.
4. `DATABASE_URL=file:./dev.db` for local SQLite.
5. `META_MARKETING_TOKEN` - keep this server-side and never commit it.
6. `META_AD_ACCOUNT_ID` - the account ID from Meta Ads Manager.

Optional values are documented in `.env.example`. Use `META_CAMPAIGN_ID` only when the view should be restricted to one campaign. Use `META_PRIMARY_RESULT_ACTION_TYPE` when the account returns more than one possible lead-result action. Add `META_CAMPAIGN_LAUNCH_DATE` only when the date is known.

Apply the database migrations and start the app:

```bash
npx prisma migrate deploy
npm run dev
```

Open `http://localhost:3000`, sign in, and use `Sync now` after the Meta read configuration is complete. The first successful run stores the initial historical window. Subsequent runs refresh recent days to account for delayed results.

## UKTL configuration

`lib/uktl-config.ts` is the typed source for:

- UK Trade Leads naming and `en-GB` locale.
- The conversion vocabulary: lead, contacted, qualified, call booked, call attended, won customer, and lost.
- Optional CPL, CPM, link CTR, budget, CAC, learning, and decision-gate inputs.
- Evidence minimums and frequency diagnostics.
- The secret-free UKTL operating brief used by the plan panel and optional AI features.

The shipped economic fields are `null`. This is intentional. Do not invent targets, budget caps, customer value, revenue, or return assumptions. When a target is absent, the dashboard says `Target not set` and continues to compare matched historical periods.

Currency and timezone are read from the successful Meta sync. Values are formatted with `Intl.NumberFormat` using `en-GB`; if the account currency is unavailable, the dashboard says `Currency pending`.

Edit `public/plan.md` only with approved UKTL context. Never put credentials, access tokens, personal data, or unverified business figures in the brief.

## What the operator sees

- Spend, CPL, CPM, link CTR, frequency, and historical trend context.
- Creative rows sorted by CPL with verdicts that stay early or unknown when evidence or targets are missing.
- A conversion path from Meta impressions and leads into the CRM stages. CRM stages remain unknown until a supported integration provides them.
- An action log for recorded operations. Meta writes remain disabled until the later approval-gated implementation.
- Optional AI summaries and creative briefs grounded in the stored state and operating brief.

The dashboard does not call Meta during page loads. It reads the durable database. A failed sync preserves the last successful read model and reports the failure without converting it to zero performance.

## Production deployment

For Vercel, use a private project and a production libSQL/Turso database:

1. Create the database and server-side auth token through your database provider.
2. Apply the committed migration SQL using the provider's supported migration workflow.
3. Set the values in `.env.example` as Vercel environment variables. Do not expose tokens to client-side code.
4. Deploy from the merged `main` branch.
5. Configure the scheduled request to `/api/cron/sync-meta` with the bearer secret represented by `CRON_SECRET`.
6. Verify a successful sync response and then verify the authenticated dashboard in a browser.

For an existing database, take a recoverable backup before applying migrations. If the database was created by an earlier schema workflow, apply the migration once and mark it applied in Prisma's migration ledger. Do not use destructive schema resets against production.

## Verification

Run the repository gates locally:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Also verify in a browser that unauthenticated requests are rejected, an authenticated empty database shows unknown values rather than zeros, a successful sync populates stored data, and the account currency and timezone are visible in the formatted output.

## Safety boundary

- Never commit `.env.local` or provider credentials.
- Missing Meta fields remain unknown; a provider error is not zero performance.
- Meta actions are not autonomous. `META_WRITES_ENABLED` stays false until the explicit safety gate for that delivery stage.
- CRM attribution must remain honest about its granularity. A Meta lead is not automatically a qualified lead or a customer.
