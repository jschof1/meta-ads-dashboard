# Customer acquisition audit — 14 October 2026

Status: implementation prepared on a review branch. Production migrations, historical imports, customer scheduling, advert URLs and conversion workflows have **not** been changed by this work. The commercial success criterion remains open until tracking is corrected and the approved release is verified live.

## What Jack can use this for

Compare the £197 advert with February using actual daily Meta data, then distinguish Meta lead events from verified CRM people, Stripe payments and subscription retention. Where attribution is missing, report the gap rather than invent an advert-level customer acquisition cost. Preserve the current dashboard, monthly history, lead register and hosting/database workflow.

## Current system: direct evidence

| Area | Verified state |
| --- | --- |
| Hosting | Existing Cloudflare Worker `uktl-meta-dashboard`; Turso/libSQL remains the durable database. No replacement infrastructure. |
| Meta | UKTL account `act_1357893439073996`, GBP, Europe/London, Marketing API v26.0. Account, campaign, ad set and ad daily insights already work. Pagination, bounded retries, adaptive creative paging, leases and atomic snapshot writes are preserved. |
| Updates | Meta daily at 06:00 UTC; saved lead register hourly at minute 45. CRM stage sync remains separately gated. New customer schedule is prepared for 07:15 UTC and disabled. |
| Saved production history at audit | Daily insights begin 11 June 2026. Latest successful scheduled Meta run: 14 October 06:01 UTC. A prior failed run recovered; keep the existing failure monitoring. |
| Pending schema | Production had eight migrations at audit. The existing lead-register lease migration and the new additive customer snapshot migration are pending. |
| Attribution | Existing explicit reporting window is seven-day click plus one-day view, using conversion date. Live ad set additionally includes one-day engaged-video view. These totals need not match Ads Manager's ad set attribution totals. |
| Advert URLs | All 26 listed ads use source, placement, campaign name and ad name; none carries stable campaign/ad set/ad IDs in its URL tags. |
| CRM | 2,716 contacts read with complete pagination; two tagged test records excluded. 399 opportunities across the existing pipelines, 183 CRM transactions, 201 calendar events in the audited historical range. |
| Qualification | No populated, verified qualification stage/tag was established. The separate qualification pipeline is empty. Keep “not verified”; do not substitute “contacted”, booked or won. |
| Stripe | Connector account and GHL connected account both verified as `acct_1OuZwXBUDoaLc39G`. Read 54 customers, 389 charges and 71 subscriptions including ended subscriptions. |
| Safety gates | Meta write gate remains false. No customer charged, payment retried/refunded, advert paused, budget changed or CRM workflow saved. |

The newly merged monthly-history and security changes from canonical main are included in this branch. Their UI, styles, CSV export and existing safeguards are retained. Dependency audit of the locked install reports zero vulnerabilities.

## What was broken or missing

1. **Individual-ad customer attribution is absent.** Both first and latest GHL attribution were inspected. Zero contacts have an account-verified individual ad ID. Five first-touch campaign IDs can be verified against Meta; names are never promoted to IDs. Current source values also include unexpanded `{{site_source_name}}` templates.
2. **Payments were not independently reconciled into a durable acquisition report.** GHL's `chargeId` commonly holds a Stripe **PaymentIntent** ID, not a Charge ID. Matching requires exact `pi_`/`ch_`, customer/contact metadata and the correct location/account. Names, amount similarity and dates are not matching keys.
3. **Qualification and attendance are sparse.** Only three explicit `showed` contacts were found in the audited calendar range. Confirmation is not attendance. A reliable qualified-lead cost cannot yet be calculated.
4. **The native booking conversion is triggered by a page view.** Vivaldi inspection confirmed `Meta CAPI - Book a Call` is published and sends a Funnel Event `Schedule` to pixel `25839137269022721` when a known contact views the VSL funnel's **Thank You** page. Its trigger does not require a calendar booking. Repeated or direct page visits are therefore a conversion-quality risk.
5. **Deduplication and consent are not proven.** The published `Meta CAPI - Lead` sends native Funnel Event `Lead` on the UKTL lead form, to the same pixel. Its recent execution logs show executed actions on 13 October; that is not a Meta receipt or deduplication proof. Both native actions have blank test-code fields and custom mapping disabled. The separately observed browser Schedule implementation needs comparison with the native sender's actual event IDs. Do not create another sender.
6. **Consent needs a clean verification and coordinated correction.** During the public funnel browser inspection, PageView was transmitted and `_fbp` appeared without a consent choice in that session. Existing profile consent cannot be ruled out by this observation alone. The original funnel's inline Pixel initialization should be reviewed alongside its consent implementation before changing it.
7. **The stored refresh window was too short for conservative restatement.** The new default refreshes 35 days; recent eight days are visibly provisional. Late corrections beyond that still require a historical refresh.

## Reconciliation: genuine customers

Exact provider identifiers linked 50 Stripe customer IDs to 49 CRM contacts, with **47 distinct people having captured payments**. Twenty-seven of those people have a paid Meta first-touch source; none can be reliably assigned to an individual advert. Four Stripe customers and 54 charges remain unmatched; no ambiguous customer matches were accepted.

The local reconciliation found 25 active paid subscribers, one past due/unpaid subscriber and 21 people whose subscriptions have ended. Those are observed subscription states, not inferred CRM stages or lifetime forecasts. The source table can show collected revenue, captured-payment refunds, failures and retention even while ad IDs are missing.

Checks included native Stripe contact/location metadata, exact GHL PaymentIntent-to-Charge matching, repeat payments, replacement subscriptions, a full refund, a released uncaptured authorisation and test-record exclusion. A released authorisation must not be counted as either revenue or a cash refund. Individual customer details and raw provider responses are excluded from this repository.

Payment failure counts cover failed Stripe charge attempts. Failures that never create a charge and historical invoice delinquency transitions are not reconstructed. Current past-due subscription status is shown separately. Collected revenue is captured charges less captured-payment refunds; it is not a payout/bank reconciliation or accounting profit, and dispute/chargeback adjustments remain outside this calculation.

## Recoverable history and the £197 advert

Successfully retrieved **2,731 daily insight rows across all four reporting levels**, covering requested months from 1 January to 13 October 2026. Private raw evidence and an isolated local review database were saved outside Git. No production history import has run. Months with no delivery on particular dates legitimately return no row; only a successful complete request establishes coverage. Missing action fields remain unknown.

Advert: `6914088373739` — BOF - Static - 197 Direct Offer - Price Lead. The same explicit attribution window and conversion-date reporting are used throughout.

| Month | Spend | Meta leads | CPL | CPM | Link CTR |
| --- | ---: | ---: | ---: | ---: | ---: |
| January | £1,162.87 | 80 | £14.54 | £16.93 | 1.274% |
| February | £1,173.73 | 77 | £15.24 | £19.77 | 1.115% |
| March | £957.02 | 63 | £15.19 | £17.88 | 0.843% |
| April | £902.36 | 57 | £15.83 | £25.40 | 0.912% |
| May | £1,210.45 | 59 | £20.52 | £23.51 | 0.796% |
| June | £1,255.39 | 43 | £29.20 | £29.13 | 0.924% |
| July | £1,248.11 | 62 | £20.13 | £38.04 | 1.250% |
| August | £1,214.07 | 37 | £32.81 | £41.91 | 1.012% |
| September | £1,066.27 | 40 | £26.66 | £39.33 | 0.948% |
| October 1–13, provisional | £381.84 | 3 | £127.28 | £36.27 | 0.893% |

February to September: CPL approximately **+75%**, CPM **+99%**, link CTR **−15%**. The deterioration is real at Meta lead-event level. Auction cost, audience overlap, landing-page conversion and creative all warrant investigation. Age alone does not establish fatigue; July also shows this is not a simple uninterrupted decline. Paying-customer profitability per advert cannot be recovered from these historical source names.

Historical limitations: missing ad IDs, absent qualification timestamps, unrecorded attendance and individual event delivery/deduplication cannot be reconstructed reliably from names or dates. Current GHL stages alone do not provide every historic stage transition. Imported contact creation dates may differ from the actual first enquiry, so cohort labels explicitly say contact-created cohort. No such gaps are filled with guessed values.

## Prepared implementation

- Authenticated, uncached acquisition endpoint using saved data only; opening the dashboard makes no new CRM/Stripe requests.
- Daily, Monday-based weekly, monthly and custom comparisons; rolling 7/14/30 completed-day presets and last-month-versus-February shortcut; campaign, ad set and ad breakdowns.
- Spend, impressions, daily reach, weighted daily frequency, CPM, link CTR, all-click CPC, primary Meta leads/CPL, indicative leads-to-link-click ratio and attribution settings. Ratios use summed numerators/denominators. Multi-day unique reach is deliberately unavailable.
- Preserved first touch and independent latest touch, checked against account-owned IDs and hierarchy. Provider rewrites flag a conflict and retain original attribution.
- Normalized CRM/calendar/payment/subscription snapshots, exact account/location guards, complete-pagination checks, retries, pacing, overlapping-writer protection, expired-run handling and preservation of the last complete snapshot on failure.
- Cohort cost per verified qualified lead, booked meeting and payer when identifiers/evidence exist; captured/refunded/net revenue, active/past-due/ended subscriptions and censored 30/90-day retention. Young cohorts are excluded, and fewer than ten eligible customers is labelled insufficient evidence.
- Source-level customer quality when advert IDs are missing; no spend allocation to an unknown source. Cohort revenue includes later renewals observed by the snapshot date, rather than pretending it was all collected during the advert spend period.
- Multi-indicator deterioration and a three-complete-week sustained check. Recommendations are advisory; no automatic advert or budget actions.
- Tracking health for history coverage, attribution gaps/conflicts, unmatched customers/charges, failed syncs, freshness, provisional conversions and unverified qualification.
- Bounded historical operator command that plans without credentials or provider access, then reuses the existing idempotent daily writer only with an explicit apply gate.

The new storage omits names, email addresses, phones, full landing URLs, click IDs, IPs and Stripe client secrets. Provider/contact IDs remain pseudonymous personal data and stay behind existing authentication and database controls. They are not anonymous data. A lawful retention/erasure policy for the new snapshots remains a release decision.

Only recognised source/medium categories are retained. Unknown custom UTM values become “other”, so personal details or credentials accidentally placed in those fields cannot flow into the snapshot or aggregate source table. Stable account-owned campaign/ad set/ad IDs remain independently checked.

## Existing senders and the supported next step

Preserve the native GHL Funnel Event integration. First correct the meaning of Schedule to a verified calendar booking and coordinate the corresponding browser event. For overlapping browser/server events, require the same pixel, event name and unique event ID, use the actual event timestamp, verify consent and inspect Meta Test Events/Event Match Quality. A timeout/session-only repeat guard is not sufficient deduplication proof.

The active website ad set optimises `OFFSITE_CONVERSIONS` with pixel event `LEAD`. HighLevel's documented Conversion Leads feedback/volume guidance concerns Facebook Instant Forms; it does not establish eligibility for this website campaign. Observed new captured-payment customers: one in the last seven days, six in 28 days. Qualification volume is unknown. Do not switch active optimisation to purchase/qualified events on this evidence. After attribution is corrected, verify event eligibility and sufficient sustained volume in Ads Manager/Events Manager before proposing a controlled change.

## Approval and verification still required

See [release checklist](CUSTOMER_ACQUISITION_RELEASE.md). The prepared dashboard and local reconciliation are not a deployed/live tracking repair. Nothing new is sending conversions to Meta. A real safe click → native form → CRM → consented Test Events exercise, verified booking → Schedule, and downstream qualified/won/payment event delivery remain open. Synthetic tests validate the reporting/matching contracts; they do not prove those external deliveries.

## Current official sources consulted

- [Meta Insights reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/insights): daily granularity, reporting date and explicit versus ad set attribution settings.
- [Meta Pixel/server deduplication](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events): event name/ID pairing and the receipt window.
- [HighLevel attribution](https://help.gohighlevel.com/support/solutions/articles/48001219997-understanding-attribution-source): separate first and latest attribution and supported tracking conventions.
- [HighLevel Facebook ad reporting](https://help.gohighlevel.com/support/solutions/articles/48001204042-how-to-set-up-facebook-ad-reporting): current UTM template; names and stable campaign ID have different roles.
- [HighLevel native CAPI workflow trigger](https://help.gohighlevel.com/support/solutions/articles/48001185099): native Funnel Events, matching and deduplication behaviour.
- [HighLevel Conversion Leads walkthrough](https://help.gohighlevel.com/support/solutions/articles/48001233833-facebook-conversion-leads-walkthrough): Instant Form scope and volume guidance.
- [Stripe API versioning](https://docs.stripe.com/api/versioning): per-request pinned `2026-09-30.endive`; no account-wide version change.
- [ICO cookies and similar technologies](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/): advertising consent applies; CAPI is not a workaround for consent or UK GDPR obligations.
