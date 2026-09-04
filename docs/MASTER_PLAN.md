# UK Trade Leads Meta Ads Command Centre

## Product goal

Build a secure, production-ready internal dashboard for UK Trade Leads that answers:

> What is happening with our Meta ads, why is it happening, and what should Jack do next?

This is a single-business internal tool. It is not a multi-tenant SaaS, client portal, replacement CRM, or generic Ads Manager clone.

The target funnel is:

Meta spend → lead → contacted → qualified → call booked → call attended → won customer → revenue.

Meta metrics are diagnostic signals. Downstream lead quality, CAC, and revenue are the eventual business outcomes.

## Architecture decisions

1. Meta is an ingestion source, not the dashboard database:
   `Meta API → sync service → database → deterministic analysis → dashboard → AI explanation`.
2. Dashboard page loads read stored data and must not depend on live Meta calls.
3. Deterministic typed analysis establishes metrics, evidence, confidence, anomalies, fatigue, and recommendation candidates before AI explains them.
4. The core build is read-only. No Meta mutation is allowed before explicit approval architecture is complete and enabled.
5. Missing/error data stays missing/error; never replace it with believable zeroes.
6. Use UK terminology and localisation: lead, CPL, qualified lead, booked call, customer, CAC, revenue, ROAS, `en-GB`, account currency, and account timezone.
7. Follow `AGENTS.md`. Before changing Next.js routing, auth, caching, middleware/proxy, or server behaviour, read the relevant installed Next.js 16 documentation in `node_modules/next/dist/docs/`.
8. Preserve useful existing code and keep infrastructure simple: Next.js, Prisma/libSQL/Turso, Vercel, Anthropic, and HighLevel when introduced.
9. Never commit secrets or expose them to browser code or logs.

## Known inherited problems

- Authentication is a client-side `localStorage` gate; server data routes are exposed.
- `.env.example` is referenced but absent and currently matched by `.env*` ignore rules.
- Meta pagination is missing and campaign filtering is incorrectly assumed in one ad path.
- Meta errors may become empty data.
- Dashboard rendering performs repeated live Meta calls.
- “MTD” is rolling 30 days.
- Learning phase is approximated at account level.
- The schema only models Snapshot, AdDaily, and ActionLog.
- UI/rules retain USD, US, webinar, registration, CPR, enrollment, and hard-coded economics from the upstream author.
- Creative AI lacks the actual creative evidence needed for some of its claims.
- AI cache is process memory.
- Meta writes exist without a mature approval/security boundary.
- Tests and CI are effectively absent.

## Target data model

Keep the schema deliberately simple:

- **Campaign:** Meta ID, name, objective, configured/effective status, dates, timestamps.
- **AdSet:** Meta ID, campaign ID, name, statuses, optimisation goal, billing event, budget, real learning-stage information, timestamps.
- **Ad:** Meta ID, campaign/ad-set IDs, name, statuses, creative ID, timestamps.
- **Creative:** ID, name, title, body, CTA, thumbnail/media identifiers, destination, URL tags, relevant raw JSON.
- **DailyInsight:** `date + level + entityId`; spend in minor units, impressions, reach, clicks/link clicks, leads, CPL, CPC, CPM, CTR, frequency, raw actions.
- **SyncRun:** trigger, timestamps, status, API version, rows fetched/written, error, useful usage diagnostics.
- **Recommendation:** type, target, severity, confidence, lifecycle, reasoning, evidence, proposed action, eventual result.
- **AiBriefing:** generation time, period/data hash, validated structured output, model/provider, linked evidence.
- Retain and extend **ActionLog** where useful.

## Delivery sequence

The ten GitHub implementation issues are authoritative work packets and must be completed in order:

1. Secure and reproducible baseline.
2. Production-grade Meta read client.
3. Durable sync and historical data model.
4. Convert the product to UK Trade Leads.
5. Operator dashboard v2.
6. Evidence-based recommendation engine.
7. Trustworthy AI analyst and creative intelligence.
8. HighLevel CRM attribution.
9. Approval-gated Meta actions.
10. Production hardening and documentation.

For each implementation issue:

1. Create the specified branch.
2. Inspect existing code before replacing it.
3. Implement only the defined scope.
4. Add or update tests.
5. Run lint, typecheck, tests, and production build.
6. Use browser testing for changed UI/behaviour.
7. Update `docs/IMPLEMENTATION_STATUS.md`.
8. Open a PR referencing and closing the issue, with summary, tests, acceptance checklist, and external blockers.
9. Do not start dependent work until the preceding PR is healthy and merged.

## External input gates

Continue with mocks/fixtures until an input is genuinely required.

- **Meta validation (PR02/03):** `META_MARKETING_TOKEN`, `META_AD_ACCOUNT_ID`; discover currency, timezone, entities, and action types. Ask which event is the real lead only if ambiguous.
- **UKTL targets (PR04/06):** target/acceptable/maximum CPL, budget, optional target CAC. Unknown targets do not block historical analysis.
- **AI (PR07):** `ANTHROPIC_API_KEY`. Deterministic features work without it.
- **HighLevel (PR08):** current private integration/API access, UKTL location, pipeline and semantically ambiguous stage mapping.
- **Production (PR10):** Vercel/database access, dashboard password, generated auth and cron secrets.
- **Meta writes (PR09):** request only at this stage, require explicit permission and `META_WRITES_ENABLED=true`.

## Non-goals and hard prohibitions

Do not add multi-tenancy, client switching, organisations, teams, arbitrary mutations, unnecessary microservices, a framework rewrite, invented UKTL targets, misleading “AI” labels, live Meta calls during dashboard render, silent zero fallbacks, ratio averaging, or autonomous ad changes.

Do not redesign the interface before data correctness, security, sync reliability, and evidence logic are established.

## Milestones

- End of PR07: secure, dependable Meta intelligence system.
- End of PR08: highest-value milestone; ads can be judged using actual lead quality and customers.
- End of PR10: production-ready system with documented recovery and verification.

If a documented external constraint makes an architectural assumption impossible, stop that PR and record the constraint, evidence, smallest viable alternative, and impact on later work. Do not silently redesign the system.
