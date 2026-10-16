# UKTL advertising and tracking launch audit — 16 October 2026

## Decision

Fix stable ad attribution, advertising consent, conversion acceptance and inconsistent offer copy before releasing the new batch or increasing spend. The existing campaign and reporting architecture can stay. The useful outcome is that Jack can trace a new advert to a genuine enquiry, booking and captured payment, and judge which adverts acquire worthwhile customers.

This task audited production and prepared recommendations. It did not change adverts, budgets, workflows, funnel code, conversion senders or customer records. No test lead, appointment, message or charge was created.

## Evidence and scope

Read on 16 October around 14:21–14:27 UTC:

- Authenticated production dashboard status, diagnostics, enquiry register and acquisition API.
- Direct Meta v26 account campaign/ad set/advert catalogue and account/advert Insights, complete catalogue pagination. Explicit attribution: seven-day click plus one-day view, conversion time, GBP, Europe/London.
- Production daily insight aggregates through read-only Turso queries.
- HighLevel quota and workflow catalogue. The catalogue confirms both native Meta workflows remain published; it does not expose their internal trigger/action configuration. Individual workflow GET requests returned 404. The available browser is signed out of HighLevel.
- Public `/free-website` and actual advert destination `/free-website-page`; incognito consent inspection; callback popup at 390 × 664.
- Existing [14 October acquisition audit](CUSTOMER_ACQUISITION_AUDIT_2026-10-14.md), [16 October release acceptance](LIVE_ACCEPTANCE_2026-10-16.md), and the website's dated analytics review. These supply historical evidence explicitly distinguished below.

Provider data continues changing during today. The most recent eight days remain provisional. Private provider responses and credentials are excluded from Git and this report.

## Account and delivery

One active Leads campaign, `TotalMatrix | AG Digital Studio`, with a £50/day campaign budget, lowest-cost bidding, one active ad set and 11 active adverts out of 26. The ad set optimises offsite conversions for **Lead**, pixel `25839137269022721`. It targets GB with age 25–65 settings and Advantage audience enabled, with trade-related employer/job suggestions. Those suggestions are not proof of strict trade-owner targeting. No customer/custom-audience exclusion appears in the returned targeting object.

TOF/MOF/BOF are names on creatives in the same ad set, not three separate audience journeys or a proven retargeting structure. Keeping one main prospecting structure is reasonable at this budget. There is no evidence here that fragmenting it into many ad sets would help. Review the irrelevant `Roof Bolter` job suggestion when next revising targeting; prioritise creative qualification and measured lead quality over speculative audience surgery.

| Direct Meta metric | 17 Sep–16 Oct | 18 Aug–16 Sep |
| --- | ---: | ---: |
| Spend | £1,451.13 | £1,491.85 |
| Impressions | 38,197 | 35,399 |
| Link clicks | 426 | 374 |
| Link CTR | 1.12% | 1.06% |
| Landing page views | 296 | 279 |
| Configured Lead events | 27 | 46 |
| Cost per Lead event | £53.75 | £32.43 |
| Lead events / link clicks, indicative | 6.34% | 12.30% |
| Lead events / landing views, indicative | 9.12% | 16.49% |
| Period frequency | 3.50 | 3.26 |

Spend fell approximately 2.7%, lead events fell 41.3%, and CPL rose 65.7%. Click volume and CTR improved. The deterioration is after the click in these reported measures, but these ratios are not person-level funnel conversion rates and do not establish a cause. Investigate conversion capture, offer consistency and visitor quality before blaming creative fatigue. A 3.50 period frequency by itself does not prove fatigue.

296 recorded landing views / 426 link clicks = 69.5%, versus 74.6% previously. Consent, repeat clicks, abandonment and measurement differences can affect this gap; it does not establish that 30.5% of visitors saw a broken page.

Direct account and advert requests were sequential, so minor differences from intraday delivery are possible. Saved dashboard spend at 11:40 UTC was £1,443.99; later direct spend was £1,451.13. This is not itself a sync defect.

## Which adverts deserve attention

| Advert | Direct spend | Meta Lead events | Event CPL | Interpretation |
| --- | ---: | ---: | ---: | --- |
| £197 Price Lead | £967.97 | 19 | £50.95 | Main delivery control; approximately two-thirds of spend. Customer profitability by advert remains unverified. |
| Plain Text Direct Offer | £142.11 | 4 | £35.53 | Promising challenger, small sample. |
| AI Comparison | £110.09 | 4 | £27.52 | Promising challenger, small sample. |

Other adverts received much less delivery; missing action fields are not declared zero. Do not pause them merely because the saved dashboard shows an unavailable CPL. Four events do not establish a durable winner, and these are Meta events rather than paying customer counts.

### Reporting limitations that affect decisions

1. **Conservative daily rollups hide known leads.** Saved Plain Text and AI Comparison period results are null, while direct period Meta Insights returns four each. The database already retains four known leads for each; respectively ten and six daily rows have unavailable lead values. This is not evidence that all four conversions were lost from storage. Improve the UI to distinguish known events with incomplete daily coverage from a complete exact total, or add an explicitly scoped period Insights read. Never fill unknown daily results with invented zeroes.
2. **Frequency has a different definition.** The dashboard's roughly 1.45 value is an impression-weighted daily diagnostic, not deduplicated 30-day reach/frequency. Direct period frequency is 3.50. Use the latter for period exposure assessment and label the former clearly.
3. **CPC needs its denominator.** Direct Meta's £2.33 CPC is spend / 623 all clicks. Cost per link click is £3.41, and per recorded landing view is £4.90. Compare matching click metrics.
4. **Attribution windows differ.** The ad set includes one-day engaged-video view in addition to seven-day click and one-day view. Dashboard reporting explicitly uses only the latter two. Align Ads Manager before comparing totals; do not silently change campaign attribution to force agreement.

## How good the tracking is

| Layer | Assessment | Evidence / remaining gap |
| --- | --- | --- |
| Delivery/spend history | Working, with the metric caveats above | Fresh successful Meta sync; direct provider reads work; dated historical reporting available. |
| Genuine enquiries | Useful and updating | Saved register 13:45:26 UTC: trailing 30 days contain 21 distinct configured-form people, 35 receipts and 12 calendar events (11 confirmed, one cancelled). These are different populations, not a lead-to-booking conversion calculation. |
| Payments and retention reporting | Working at source level, incomplete joins | Saved customer refresh 12:02:27 UTC. Four unmatched Stripe customers, 54 unmatched charges, one non-GBP charge excluded; zero ambiguous matches/conflicts accepted. First automatic customer run is due 17 Oct at 07:15 UTC and remains unobserved. |
| Individual advert to customer | Not reliable enough for optimisation | All 26 URL-tag strings omit stable campaign/ad set/ad IDs. Customer snapshot flags 279 Meta-attributed contacts without ad IDs across retained history. This is not 279 newly lost leads. |
| Qualified lead and attendance | Incomplete | Qualification mapping unconfigured. Zero recorded attendance in a selected cohort means no recorded attendance evidence, not that nobody attended. |
| Pixel + native server events | Partly present, end-to-end acceptance open | Browser PageView observed; native Lead and Book a Call workflows are published. Server receipt, match quality, deduplication and precise trigger behaviour need Meta Test Events plus CRM evidence. |
| Advertising consent | Reproducible defect | Incognito `/free-website` sent Meta PageView and set `_fbp` before a consent choice. After rejecting optional analytics, reloading `/free-website-page` still loaded Facebook pixel/config/tracking resources and ran unconditional `fbq('init', ...)` / `fbq('track', 'PageView')`. |

The analytics choice describes PostHog. It does not currently control the provider funnel's separate inline Meta bootstrap. Fix the existing integration across browser and native server paths; adding another CAPI sender would create more uncertainty.

The acquisition API's 17 Sep–16 Oct first-touch contact cohort currently has two source-linked payers across `fb` and `ig` and two unattributed payers. These are outcomes observed by the saved snapshot for a contact-created cohort, not all payments in the spend period. Do not divide total Meta spend by those two source-linked people and claim a verified CAC or ROAS.

Historical name-based advert matches can be investigation hints. They do not substitute for account-verified numeric ad IDs, particularly where ad names, dynamic templates or payment-created contacts are ambiguous.

## Changes before the new batch

Owner: Jack / the implementing agent. This audit records the work; the following changes are not applied.

1. **Store stable identity from click to contact.** Preserve existing UTMs and add `campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}` to the new ads' URL parameters. First verify the real funnel saves each value in usable first/latest attribution or protected CRM fields. Arbitrary parameters are not guaranteed to persist. Prove a consenting real click resolves the templates, creates the expected single contact and retains first touch after a return visit. Carry verified CRM identity into Stripe metadata; keep unknown history unknown. Put placement in a separate field in any future convention; coordinate any `utm_medium` change with existing GHL attribution rules.
2. **Coordinate advertising consent.** Gate the original Meta bootstrap and native server events consistently. Verify no-choice, reject, accept and withdrawal on both funnel aliases and booking/thank-you pages. Preserve functional form/calendar delivery and documented first-party data needed for enquiries. Do not copy advertising identifiers into general analytics.
3. **Correct and verify meaningful conversion triggers.** The 14 October authenticated UI audit found native `Meta CAPI - Book a Call` firing Schedule when a known contact viewed the Thank You step. Today's workflow catalogue still shows it published, last updated November 2025; its internal trigger was not re-opened today. Recheck and replace that page-view trigger with the supported Customer Booked Appointment trigger and exact calendar filter. Verify repeat/direct thank-you visits cannot produce a booking. This is a Schedule quality issue; the live ad set currently optimises Lead, so it does not alone prove Lead optimisation is broken.
4. **Run one controlled, consenting journey through Meta Test Events.** Accepted form submission -> one CRM contact/form receipt -> one Lead business event; confirmed calendar booking -> one real appointment and Schedule business event. Check browser/server copies, event IDs, Meta receipt, matching inputs and refresh/revisit deduplication. Keep native sender; HighLevel documents automatic shared event IDs when available. Missing manual mapping or a blank test-code field does not prove deduplication failure. Suppress sales outreach for the controlled identity and exclude it from reports. No synthetic production purchase is necessary: reconcile an existing captured Stripe payment to the same CRM identity rules.
5. **Make the promise consistent.** The active Review & Results carousel body says £297/month while its description and landing page say £197. Active Price Lead body variants say live in two weeks, versus seven days on the page. Several creatives contain mixed price/delivery variants. Use one approved price, realistic delivery promise and guarantee wording across all copy variants, video, carousel cards, headline and destination. Substantiate the public 2.3× leads / 2–3× work / 5–10 extra jobs claims with appropriate client evidence or remove the unsupported claims from the new batch. A claimed seven-day build must be deliverable at the intake capacity available.

HighLevel's [workflow documentation](https://help.gohighlevel.com/support/solutions/articles/48001185099) identifies Customer Booked Appointment for funnel booking conversions and describes reuse of the funnel event ID when available. Its [funnel setup guide](https://help.gohighlevel.com/support/solutions/articles/48001236281-how-to-set-up-a-funnel-event-pixel-for-facebook-conversion-api-) documents exact form/calendar filters and native mapping defaults. Provider capability is not proof this account passed acceptance.

## Practical next-batch plan

This is a recommendation for Jack's account, not a claimed Hormozi budget rule or an applied change.

- Keep a recognised control and test about three distinct challenger concepts in a manageable batch. At £50/day, 11 live ads already receive highly unequal delivery. Avoid launching dozens of combinations simultaneously and assuming each gets a fair test. If guaranteed comparison is necessary, design a bounded experiment with its own budget rather than expecting equal delivery in the existing ad set.
- Test three concrete problems: paying for shared marketplace leads; missed enquiries while on the tools; and a website/review/follow-up system demonstrated on an actual client setup. Use authentic proof and one specific next action, such as request a callback.
- Prepare multiple opening hooks for each concept while keeping the body/offer/CTA controlled where practical. Name versions with a simple angle/hook/body/CTA code; stable IDs are still the attribution key.
- Keep Lead as the current optimisation target while validating it. Sparse, unverified qualified/sale events are not a sound reason to switch optimisation immediately. Record qualified, attended and paid outcomes consistently, then assess whether enough reliable volume exists for a deeper event.
- Decide allowable acquisition spend using collected cash, delivery costs, refunds, churn and observed retention. Example sensitivity only: at £53.75 per Lead event, a genuinely measured 10% lead-to-paid rate would imply about £537.50 media cost per customer; 20% would imply £268.75. Neither rate is established here, and Meta event duplication would invalidate that calculation. The £197 monthly price is revenue, not contribution profit or a proven acquisition ceiling.
- Review delivery and genuine enquiries daily; review each cohort's bookings, attendance, payments and refunds weekly, allowing conversion lag. Use reporting gaps as unknowns. Scale when paid customer economics and delivery capacity support it, not because CTR is high.
- Check phone/SMS routes alongside form attribution. The page offers a freephone call route and SMS to a different mobile number. Existing analytics records clicks as intent; a click is not a delivered message, connected call or new enquiry. Confirm actual destination ownership, received calls/messages and CRM source capture separately.

## Hormozi research and application

In his original [Run Paid Ads episode](https://podcasts.apple.com/us/podcast/part-6-run-paid-ads-%24100m-leads-book/id1254720112?i=1000624977754), [transcribed here](https://podscripts.co/podcasts/the-game-with-alex-hormozi/part-6-run-paid-ads-100m-leads-book), Hormozi advises separating callout, value and CTA; producing more opening variations; matching ad and landing-page promises; establishing tracking before spending; and assessing acquisition against gross profit and cash recovery. Relevant points: about 10:42, 18:16, 31:30, 35:43 and 39:43–45:16. His official [Paid Ads I](https://www.acquisition.com/training/leads8) and [Paid Ads II](https://www.acquisition.com/training/leads9) are the corresponding training modules. Their public page text exposes module navigation, not a searchable lesson transcript.

For UKTL, apply that by testing specific trade-owner problems with real proof, consistent £197 offer wording, traceable ad IDs and verified paid outcomes. The small initial batch, budget pacing and launch priorities above are this audit's judgement rather than direct quotations or universal rules from him.

## Acceptance and remaining uncertainty

The mobile callback popup opened and all three inputs plus submit were within the 390 × 664 viewport; submit was hit-testable and there was no horizontal overflow. Turnstile reported error 600010 in automation, so this inspection does not prove submission works on a real phone. Repeat with a normal mobile/in-app browser and a controlled identity. Keyboard-open behaviour, actual SMS/call receipt, a full CRM journey and Meta Events Manager diagnostics remain unverified.

Launch acceptance: stable IDs persist; advertising choice controls both event paths; one accepted lead and one real booking produce correct Meta/CRM records without duplicate business events; copy agrees; reporting gaps are understood. After those pass, a bounded new creative batch is reasonable without rebuilding the funnel or waiting for perfect historical attribution. Retain an owner for later qualification mapping, payment-join gaps, dashboard period metrics and the first scheduled customer refresh.
