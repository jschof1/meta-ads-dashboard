# Live acceptance check — 3 October 2026

Purpose: give Jack trustworthy real-ad reporting and a saved enquiry follow-up
register, not another prototype. This is a bounded production check, not proof
of better lead quality, customers or revenue attributable to advertising.

## Repository and production evidence

- Canonical repository: `jschof1/meta-ads-dashboard`; starting `main`
  `4aa41e2927baf1b5c4ef1ed67ca08394f2a43db9`, freshly fetched with no remote drift.
- [PR #20](https://github.com/jschof1/meta-ads-dashboard/pull/20) merged on
  8 September at `fc63764af2cc2b273447544078d9db67d9bcdef3`. The old draft-PR
  handoff is obsolete. Production acceptance remains separate from code merge.
- Existing app: <https://uktl-meta-dashboard.jackschofield1.workers.dev>.
  The signed-in Cloudflare dashboard shows active version prefix `491585b9`
  at 100%, manually deployed with Wrangler. There is no Git repository
  connection on this Worker yet; the Connect dialog exposes the existing
  `jschof1` integration and the canonical repository selector. No connection
  was saved or deployment triggered while CI is blocked.
  Existing Turso database: `uktl-meta-dashboard`; no resources were created,
  subscriptions changed, migrations applied or database contents reset.
- The secret helper was checked first. The documented owner-only production
  handover (mode 0600) already contains Meta, Turso, dashboard and HighLevel
  credentials. They were consumed in process only, never printed or committed.
- `test:cloudflare` passed: protected pages/APIs, secure login/logout, two
  authenticated sessions, concurrent durable reads, eight successful migrations
  through `20260909140000_lead_register`, and disabled Meta writes.
- Production `SyncRun` proves a real scheduled import at
  `2026-10-03T06:01:39.365Z`: `SUCCEEDED`, 334 rows fetched/written. The previous
  four days also succeeded. The most recent failed scheduled import remains
  15 September, before the documented pagination recovery.
- A fresh authenticated manual import succeeded with 337 rows fetched/written,
  run `cmusdvh8p0000251lxj89k2qs`. This reads Meta and updates stored reporting;
  it does not mutate ads, budgets, campaigns or CRM records.
- Dashboard account is `act_1357893439073996`, GBP, Europe/London; entity metadata
  is current. Missing Lead evidence remains a warning, not invented zeroes.
- The saved HighLevel register was read successfully: 2,099 stored entries,
  checked `2026-10-03T12:33:13.876Z`. Entries include historical/active contacts
  and are **not** 2,099 new enquiries. No names, messages or contact details
  were copied into this report. This fresh snapshot alone does not prove which
  invocation refreshed it.
- Production action gate is disabled; database count of executed `MetaAction`
  rows is zero. No Meta write was enabled or attempted.
- Fresh live Chromium checks passed at 1,440px and 390px: successful browser
  login, visible read-only mode, no horizontal overflow and no page errors.

## Matching-date Meta check

For 2 October, account-wide Graph v26 with `action_report_time=conversion`,
`7d_click,1d_view`, GBP/Europe-London and primary result
`offsite_conversion.fb_pixel_lead`, a fresh read after the manual import matched
the durable account row exactly: **£44.26 spend, 1,018 impressions, 15 link
clicks and zero returned Lead events**. The action collection was present, with
no configured or competing Lead action; CPL remains unavailable because there
are no leads. This is not a claim about CRM enquiries or customers.

Before refresh, the morning snapshot had £44.23 and 1,014 impressions. The fresh
import brought the stored row into agreement with the current provider read;
the earlier observation was not silently labelled reconciled. This check is
direct Meta API versus database, not a newly inspected Ads Manager screen.

## Remaining boundaries

- Stage-based CRM attribution is disabled. The existing business clarification
  says contacted is a tag, booked calls are calendar evidence and qualification
  is undefined. Do not ask for fabricated stage IDs or infer attendance/won
  customers from those signals. The saved enquiry register works independently.
- Optional Anthropic is not configured in production; deterministic reporting
  works without it. Prior synthetic Anthropic validation is not live business
  outcome validation.
- The latest pre-repair [main CI run](https://github.com/jschof1/meta-ads-dashboard/actions/runs/36013027309)
  failed at `npm audit --audit-level=high`; later checks were skipped. Old green
  CI and September's test count do not certify the current release.
- Both helper credentials `CLOUDFLARE_PAGES_TOKEN` and `CLOUDFLARE_API_KEY` verify
  as active, but read requests for this Worker's deployments return HTTP 403.
  Global Wrangler has no logged-in operator session. **This is a CLI limitation,
  not an account access blocker:** the existing signed-in browser accesses the
  correct Worker and its GitHub connection controls. Do not request wider
  tokens before using that existing route when a release is eligible.

## Bounded repairs prepared in this resumption

- Next.js and its matching ESLint packages: 16.3.4 → 16.3.6; Wrangler:
  4.129.1 → 4.143.1, with compatible transitive security updates. The original
  Sharp/libheif failure and newly reported Next.js/Undici/brace-expansion issues
  are addressed without changing the audit threshold.
- Compatible `fast-uri` 3.1.8, `hono` 4.13.12 and `ip-address` 10.7.3 updates
  remove the remaining moderate findings. Clean install passed; final audit
  reports **zero critical, zero moderate and eight high dependency-path
  findings**, all rooted in the single unresolved `braces` advisory below.
- Production browser-smoke fixtures now include the durable enquiry register
  and its location ID. The previous fixture generated six `/api/lead-register`
  503s after later UI additions. The check now proves two receipts belong to
  one person, verifies missing-provider refresh returns an explicit error and
  preserves saved data, and still rejects every unexpected browser error.
- Fresh local lint, typecheck, 332 tests, production Next.js build, remote
  HTTPS/libSQL scale/rollback smoke and 12 production-browser checks passed.
  These checks do not override the failing security audit or establish that
  these changes are deployed. The final CI result must be inspected separately.

## Smallest remaining release gate

The unresolved high-severity [braces advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects every published version through 3.0.3, with no patched version listed
when checked on 3 October. It enters through micromatch/fast-glob in the Next.js
lint tooling and shadcn tooling. Do not downgrade Next, delete lint checks,
lower the audit threshold, relabel the dependency, or merge/deploy red CI.
The required input is a supported patched dependency path, not another
Meta/Turso/HighLevel token or invented CRM mapping.

Once that upstream gate is resolved and every check is green, the owning agent
can use the signed-in dashboard's existing GitHub integration to connect this
repository to this exact Worker, with a build/deploy command preserving all
verification gates and no preview exposure. Alternatively reuse an authorised
Wrangler session. Preserve current runtime secrets, crons and false write flag;
do not create another Worker or paid resource. Verify the actual released
version and repeat live smoke checks. PR10 remains incomplete until that release
evidence and documented integration boundaries are resolved or explicitly
deferred. There is no new credential request for Jack at this point.
