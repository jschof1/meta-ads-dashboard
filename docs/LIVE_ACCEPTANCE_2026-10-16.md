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
HTTPS/libSQL sync, rollback and idempotency checks passed. Final browser,
Cloudflare build, CI, migration and live acceptance results are recorded below
when completed.

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
