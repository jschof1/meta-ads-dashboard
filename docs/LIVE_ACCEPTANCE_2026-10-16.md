# Dashboard release acceptance — 16 October 2026

Owner: dashboard delivery task. Jack authorised finishing proposed implementation
and getting it live on 16 October. This record separates deployment from customer
attribution and external workflow acceptance.

## Verified before release

- Canonical main `2a41d0c` and live Worker version
  `c06211ed-c36f-4611-a64a-d2195cf55e36` include PR31's same-day enquiry fix.
- Today's scheduled Meta import succeeded at 06:01:22 UTC. Authenticated
  diagnostics report a reachable database, nine matching migrations, and disabled
  Meta writes. Stage-based CRM qualification is unconfigured.
- Acquisition API returned 404: PR30's reporting was genuinely unreleased.
- Production contains 3,055 daily insight rows, including 2,191 ad rows, with
  history from 20 November 2025 through 16 October 2026. No history import is needed.
- A private database replica backup was retained under the existing owner-only
  configuration directory, with a schema/checksum/count manifest. Both replica
  and standalone offline integrity checks returned `ok`. Credentials and backup
  contents are excluded from Git.

## Release changes

PR30 is brought up to date with main and preserves PR31. Its new customer form
reader now also requests tomorrow's exclusive date boundary, includes today's
receipts, and filters out evidence beyond the precise observation time. A
regression covers the London midnight boundary and incomplete collection.

The Worker explicitly sets `META_RECENT_REFRESH_DAYS=35`, preserving the existing
Meta/HighLevel schedules and disabled write/stage-sync gates. Customer sync stays
disabled: there is no restricted unattended Stripe credential in the secret
helper, existing protected handover or deployed Worker bindings. No customer
snapshot or payment/retention result is invented.

## Verification

Before the final correction: 388 automated tests and seven dashboard reader tests
passed. After correction: all 22 customer journey tests, lint, typecheck and the
Next production build passed. Dependency audit: zero vulnerabilities. Remote
HTTPS/libSQL sync, rollback and idempotency checks passed. All 389 tests passed after the correction, as did all 13 isolated production-browser checks. Cloudflare build/dry run and the full independent GitHub CI passed before merge.

## Remaining work and next real use

Jack can use the released report to compare individual adverts and Meta delivery
periods immediately. Payment and retention reporting requires a restricted
`STRIPE_READ_KEY` for account `acct_1OuZwXBUDoaLc39G` with account, customers,
charges and subscriptions reads. Supply it only through the secret helper or
Cloudflare secret settings. The existing read-only CRM connection/form/calendar
must then pass reconciliation before enabling the customer schedule. Record a
snapshot retention/erasure policy before persisting provider customer IDs.

The delivery owner must revisit customer activation when the credential is
available; verify an authenticated refresh and the first real 07:15 UTC scheduled
run. Qualification remains unknown until a populated existing tag/stage is
verified. Individual-ad customer profitability also needs stable ad IDs on real
CRM records. Historical IDs cannot be inferred from advert names.

The 14 October audit found the native booking CAPI workflow triggered by a
thank-you page view. Stable-ID capture, consent gating, booking trigger correction
and a consenting full Meta Test Events journey remain external acceptance work;
this dashboard deployment does not apply or prove them. Use phase three of the
[release checklist](CUSTOMER_ACQUISITION_RELEASE.md) and preserve the current
native sender and routing while testing. No live ad budget or conversion sender
is changed by this reporting release.

## Rollback

Restore prior Worker version `c06211ed-c36f-4611-a64a-d2195cf55e36` if needed;
leave the additive customer table and historical data intact. The private backup
is available for exceptional database recovery. Do not reset or drop production
rows to roll back the application.

## Live acceptance completed

- PR30 merged as `f7391c2c9d94ed7035fe70d7704ef77fe00fb40b`.
- Existing Worker deployed as `bb96f0d0-aa2b-48ab-a4df-f3ad3dd60b58`,
  tagged `f7391c2`, with all four schedules registered. Customer sync remains
  disabled and Meta writes remain disabled.
- Only migration `20261014160000_customer_journey` was pending and applied;
  ten migrations now match. All 3,055 historical insight rows survived unchanged
  before the normal refresh. Customer snapshot count remains zero.
- Live Cloudflare smoke passed for two independent sessions, secure cookies,
  native form login, logout, repeated/concurrent database reads and protected
  API/page boundaries. An early smoke during the migration/deploy transition
  observed the old Worker's expected migration mismatch; the final deployed
  Worker passes. No unresolved database failure remains.
- Authenticated acquisition API returns 200 with 14 advert comparisons and
  complete February/September coverage. Malformed dates return 400; signed-out
  acquisition/customer-cron access returns 401. Authorized customer cron returns
  an explicit disabled skip without contacting providers.
- The £197 Price Lead advert matches the earlier audit: September £1,066.27 /
  40 leads / £26.66 CPL; February £1,173.73 / 77 leads / £15.24 CPL.
- A real manual Meta refresh succeeded, fetching/writing 661 rows for
  12 September–16 October (35 calendar days). Run `cmvawbn2u0000u71o7n37t8do`.
  The provider omitted website-inquiry results on 108 rows; these remain unknown,
  not zero. No history re-import or advertising mutation was performed.
- The actual live browser rendered the acquisition panel. At 390×664, February
  comparison and Apply controls worked, correct saved comparison dates returned,
  there was no page horizontal overflow and no report error. Desktop rendered at
  1280px without page overflow. Live mobile screenshot retained in the private
  browser-artifact directory.

## Stripe access follow-up

Jack asked the agent to add the restricted key. The T3 preview could automate an
existing hidden tab but did not display to Jack; opening a new tab reported no
preview automation host. A visible Vivaldi tab was opened as a fallback. Stripe
and Google sessions there are signed out. No key has been created or installed.
The tab is retained for Jack's sign-in, after which the delivery task can prepare
minimum read permissions, store the credential privately in the existing Worker,
reconcile provider reads and complete customer-sync activation. Never ask Jack to
paste a secret in chat. The release itself is live independently of this gate.
