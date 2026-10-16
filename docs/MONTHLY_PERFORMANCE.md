# Monthly performance

Jack can use **Monthly history** on the dashboard to review calendar-month spend,
Meta Lead events and saved HighLevel enquiries/bookings, select a month for its
campaign or ad breakdown, and export aggregate figures to CSV. The report is
independent of the overview's rolling period selector.

## Reporting contract

- Reads one database transaction through the existing authenticated session.
  `/api/dashboard/monthly` never calls Meta, HighLevel or other providers.
- Saved ad history from 1 November 2025 onward, retained as time passes rather
  than hidden by a rolling twelve-month cutoff. Reporting is scoped to the configured
  account, campaign scope and attribution window, from successful imports only.
- Days omitted by the latest successful refresh remain unknown. Currency
  mismatches, missing metrics and missing lead receipts remain unavailable.
- Historical unknown lead values may be reconstructed from valid original
  `rawActions` when their saved result event matches the configured event. This
  uses the existing Meta result diagnostic, preserves conflicting events as
  unknown, and does not alter any stored row.
- Spend, impressions, link clicks and leads are summed. CPL, link CPC, link CTR
  and CPM use those totals, never averages of daily rates. Daily reach is not
  summed into a fictitious monthly audience.
- The current month is explicitly month to date. Comparisons exclude today,
  match elapsed calendar dates in the account timezone and require every day
  in both windows. Full months compare with the preceding full calendar month.
  A shorter previous month suppresses a matched MTD comparison.
- Missing days are labelled partial; observed partial totals are retained.
  HighLevel whole-month counts are withheld when saved coverage does not cover
  the month. The coverage-start day is conservatively excluded because the
  initial collection began during that day.
- HighLevel is the whole configured location across all sources, not Meta
  attribution. Receipt IDs, contact IDs and appointment IDs are deduplicated;
  records marked test are excluded. New CRM contacts may include imports.
- Appointments use their scheduled date and stop at the saved register's
  timestamp. Cancelled events are reported separately and excluded from the
  headline appointment and booked-person counts. Confirmation is not attendance.
- No qualification, payment, customer revenue, ROAS or cross-source conversion
  rate is invented. Names in ad/campaign breakdowns reflect current saved metadata.
- API and CSV return aggregates, source timestamps and reporting context; no
  contact details, tags, contact identifiers, receipts or credentials are returned.
- Refresh failures preserve the last displayed report with an explicit warning.
  Refresh reads saved storage only; the existing scheduled imports own freshness.

## Checks

`tests/monthly-performance*.test.mjs` and `tests/stored-result-events.test.mjs`
cover weighted rates, missing values, currency, scope/account/attribution isolation,
receipt reinterpretation, latest-import omissions, timezone boundaries, partial
months, matched comparisons, cancellation/test exclusions, deduplication,
aggregate-only export, retained November 2025 history and route authentication.

No database migration is required. The production schema and hourly HighLevel
import remain unchanged. Deployment still requires the existing repository CI
and security gate; a feature build is not a production release.

## Historical import

Run `npm run backfill:meta-history` to plan monthly requests from 1 November
2025. It does not read credentials, call providers or write data by default.
After release approval, load the existing operator environment and use
`META_HISTORY_APPLY_APPROVED=yes npm run backfill:meta-history -- --apply`
to import daily account, campaign, ad-set and ad history. Optional `--since`
and `--until` dates bound a repair to the required interval.
This uses the existing paced, leased, atomic Meta import and preserves its scope,
attribution, result-event and currency contracts. It changes saved reporting
records only, never campaigns, tracking tags or HighLevel data. Subsequent
scheduled imports continue refreshing recent days and retain the earlier rows.
Missing delivery days remain partial coverage, not fabricated zero results.
