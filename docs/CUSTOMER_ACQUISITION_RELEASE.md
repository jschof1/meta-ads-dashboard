# Customer acquisition release checklist

Owner: Jack approves consequential production changes; implementation and verification stay with this task. No production change is authorised merely because the branch is pushed.

## Phase 1 — saved reporting and historical recovery

Approval target: merge the reviewed branch, apply the one pending additive customer migration through the existing Turso migration workflow, and deploy the existing Cloudflare Worker with customer sync **disabled**. Preserve current monthly UI, November 2025 history, schedules, saved data, Meta write gate and CRM stage gate. A separate authorised task has already applied the ninth lead-register lease migration and imported historical Meta data; this task independently verified those saved records and must not repeat that import unnecessarily.

The existing release's security checks must remain green. Record the pre-release Worker version, applied migration checksums and scoped daily row counts. Use the existing backup/recovery workflow before database mutation. Apply only committed migrations through `scripts/apply-turso-migrations.mjs`; do not guess or reset a baseline.

Plan, with no provider access or writes:

```sh
npm run backfill:meta-history -- --since=2026-01-01 --until=2026-10-13
```

After approval, execute with existing credentials loaded privately into the operator environment:

```sh
META_HISTORY_APPLY_APPROVED=yes npm run backfill:meta-history -- --since=2026-01-01 --until=2026-10-13 --apply
```

Use the plan/apply command only if a correction or missing range requires it, with approval for that write. Run one normal current Meta refresh after deployment to collect the expanded CTR/attribution fields, then reconcile the £197 advert's February and September figures against the recorded audit. Repeat import must leave daily identities/counts stable; retain successful run coverage, attribution keys, currency and time zone. A failed batch retains previous data; retry that month, never sum imported snapshots.

Set the approved recent-refresh configuration to 35 days; an existing explicit `META_RECENT_REFRESH_DAYS=7` override would otherwise take precedence over the new default. Check the saved run's requested date range after deployment.

Use the existing Cloudflare deployment script. Verify authenticated saved-data reads, mobile layout, failed refresh handling, source freshness, and disabled Meta/customer write paths on the actual Worker. Local build/preview is not live acceptance.

Rollback: return to the recorded prior Worker version, leave customer sync disabled and retain additive tables. Do not drop customer snapshots or historic Meta rows as a routine rollback. Historical reporting corrections may require re-fetching the affected dates; retain before/after counts and checksums.

## Phase 2 — verify and activate read-only customer synchronisation

Requires a securely supplied restricted **live read-only** Stripe key for `acct_1OuZwXBUDoaLc39G`; the conversational connector cannot supply an unattended Worker credential. Minimum reads: account identity, customers, charges and subscriptions. Never paste the key into chat, Git, reports, CLI arguments or browser URLs. Use the secret helper/Cloudflare secret workflow. The adapter verifies the actual account before reading collections and makes only GET requests.

Check the existing GHL token has read access to contacts, opportunities/pipeline, form submissions, the configured calendar and payments. Retain exact UKTL location, pipeline, form and calendar IDs. Confirm calendar history and future 90-day booking coverage. Larger accounts that exceed safe pagination limits must fail closed rather than publish a partial snapshot.

Choose a lawful snapshot retention/erasure policy and verify access permissions before persisting customer IDs in production. API output is aggregate only, but stored IDs remain personal data. Do not enable a qualification mapping until an existing populated tag/stage is confirmed. If a stage is selected, it must belong to the configured pipeline.

Set `CUSTOMER_JOURNEY_SYNC_ENABLED=true` only after configuration/read-only reconciliation approval. Perform one authenticated customer refresh, check exact account match, missing/ambiguous identity counts and last complete snapshot preservation, then verify one real 07:15 UTC scheduled run. Logs must contain only run status/counts, never provider bodies or credentials. Keep an owner for failed/stale sync follow-up; no new notification destination is configured by this branch.

## Phase 3 — attribution and meaningful conversions

These are separately reviewable production changes because they affect live advertising, the funnel and CRM workflows.

1. Preserve the current advert URLs and native workflow configuration as rollback evidence. HighLevel's documented base template is:

   ```text
   utm_source=fb_ad&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}
   ```

   Prepare stable `ad_id={{ad.id}}` and `adset_id={{adset.id}}` parameters as an additive capture proposal. Test that native GHL stores these in first/latest attribution or dedicated protected fields; do not assume arbitrary parameters are retained. Do not add extra custom UTM conventions or update all live adverts blindly. Meta preview links may leave dynamic templates unexpanded; a real consenting click is the acceptance check. Deployment of this dashboard alone does not add IDs to new leads.

2. Confirm first/latest touch survive a return visit from another channel. Retain only account-owned numeric IDs; never infer an ID from campaign/ad names. Verify submission/contact stable IDs, a real calendar booking ID and Stripe customer/intent/charge metadata across a small private sample. Exclude synthetic records from commercial reporting.
3. Correct consent gating on the existing provider-owned funnel before adding/expanding advertising events. Preserve forms, calendar routing, lead creation/deduplication and follow-up behaviour. Test reject/accept/withdraw paths, and do not store or send advertising identifiers without the applicable permission. Test sessions must not enrol real customers in sales follow-up or generate charges.
4. Change the existing native Schedule workflow from Thank You page views to a verified booking trigger, with the exact calendar filter. Align any browser Schedule sender to the same booking receipt and event ID. This is a proposed change, not an applied edit. Verify repeat page loads and repeat webhook delivery create one logical conversion; distinct bookings must remain distinct.
5. For a consenting safe test, use Meta Test Events through the existing native integration or an isolated disabled test workflow, never add another active sender. Check pixel/dataset, event name/ID, event time, action source, hashed matching fields, source URL, consent, permissions and Meta acknowledgement. Remove test code afterwards and read back the saved configuration. Native workflow “Executed” is not sufficient proof of Meta deduplication.
6. Add qualified/won/verified acquisition feedback only after an existing stage definition, first-party identity mapping, supported event eligibility and volume are demonstrated. Use stable contact/opportunity/payment IDs for replay protection and actual transition timestamps. Qualification/purchase feedback must not suddenly become active campaign optimisation. Refunds, failures and cancellations must not be sent as new purchases.

Success remains open until Jack can use the live dashboard to evaluate verified advert-level acquisition and retention. Historical source-level reconciliation and Meta trend recovery are valuable now; missing historical ad identities remain an explicit limitation.
