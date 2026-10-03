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
  The old global Wrangler 4.46 did not find an operator session. A subsequent
  local check with Homebrew Node and the already-installed Wrangler 4.147.0
  **did** recover the existing encrypted OAuth session through macOS Keychain:
  `whoami` confirmed the correct account and `workers_scripts` write scope.
  No credentials were read/exported and no new authorisation was granted.
  Hosting access is not blocked; do not request a wider token or change browser
  permissions. The signed-in dashboard also accesses the correct Worker and
  its existing GitHub connection controls.

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
  one person, clicks the refresh control with no provider token, verifies its
  visible error, retained row and restored button, and checks unchanged durable
  data. An isolated failure page allows exactly its one expected 503 resource
  error; all other console/runtime errors and external requests still fail.
- Fresh local lint, typecheck, 332 tests, production Next.js build, remote
  HTTPS/libSQL scale/rollback smoke, 12 production-browser checks, Cloudflare
  build and Wrangler deployment dry run passed. The final browser run completed
  at `2026-10-03T13:09:27.946Z` against the rebuilt production application.
  These checks do not override the failing security audit or establish that
  these changes are deployed. The final CI result must be inspected separately.

## Review and delivery

- Follow-up [PR #26](https://github.com/jschof1/meta-ads-dashboard/pull/26)
  contains the actual dependency, smoke-test and documentation changes. It is
  draft and must remain unmerged while the security gate is red.
- Independent standards and spec/security reviews found a non-fail-fast shell
  recipe and missing browser-level refresh-failure assertions. The recipe now
  chains every gate with `&&`; a hermetic shell simulation confirms a failed
  audit stops before all later commands, without executing deployment. The
  browser correction described above passed a fresh run. Neither correction
  changes application behaviour or weakens the audit.
- The first [follow-up CI run](https://github.com/jschof1/meta-ads-dashboard/actions/runs/37125123060)
  was inspected in full: its only job installed successfully, then failed at
  the unchanged audit with the eight `braces` paths. Later verification steps
  were skipped by the fail-fast workflow; their local passes are not CI passes.
  Final-head check status and review disposition are recorded on the PR.

## Smallest remaining release gate

The unresolved high-severity [braces advisory GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
affects every published version through 3.0.3, with no patched version listed
when checked on 3 October. It enters through micromatch/fast-glob in the Next.js
lint tooling and shadcn tooling. Do not downgrade Next, delete lint checks,
lower the audit threshold, relabel the dependency, or merge/deploy red CI.
The required input is a supported patched dependency path, not another
Meta/Turso/HighLevel token or invented CRM mapping.

Once that upstream gate is resolved and every check is green, the owning agent
can reuse the verified local encrypted Wrangler session to release to this
exact Worker. The dashboard's existing GitHub integration is an alternative,
but remains unconnected: any future connection must preserve all verification
gates and avoid preview exposure. Preserve current runtime secrets, crons and false write flag;
do not create another Worker or paid resource. Verify the actual released
version and repeat live smoke checks. PR10 remains incomplete until that release
evidence and documented integration boundaries are resolved or explicitly
deferred. There is no new credential request for Jack at this point.
