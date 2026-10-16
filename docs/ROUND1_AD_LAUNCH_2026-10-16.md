# Round1 Meta ad launch — 16 October 2026

## Published outcome

All three supplied Round1 creatives were published to the **original ad set**, `UK 25+ | Audience Recommendation` (`6890146663939`), in the original campaign `TotalMatrix | AG Digital Studio` (`6890146663739`), account `1357893439073996`. No new campaign or ad set was created.

Jack authorised publishing, keeping the existing successful ad, and using judgment on budget. He confirmed the video statements and keep-the-website refund promise as true. The final budget decision was **£50/day campaign budget unchanged**, with an **average £20/day allocation across the three test ads**, within that campaign budget.

Direct Meta readback after publication:

| Creative | Ad ID | Creative ID | Effective status at verification |
| --- | --- | --- | --- |
| `ad-1.png` — We Build It You Own It | `52555243798943` | `2193205601600077` | Pending review |
| `ad-2.png` — Stop Renting Leads | `52555243799143` | `1077504948496612` | Active |
| `new-video-ad-2-4x5ratio.mp4` — Wish I Found These Guys Sooner | `52555243799343` | `1530681559085917` | Pending review |
| Existing £197 Price Lead control | `6914088373739` | `1395877262192393` | Active |

All four read back with campaign `6890146663739` and ad set `6890146663939`. Every new ad has configured status ACTIVE; effective review/delivery status is separate and can change. Active does not establish impressions, an enquiry or customer success.

The catalogue grew from 26 to 29 adverts. Comparison of every pre-existing advert's configured status and creative ID found **no changes**. The control's update timestamp remained 5 January 2026. Campaign daily budget read back as `5000` GBP minor units, with its previous update timestamp unchanged.

## Test structure and limits

- Name: `R1 | Three creatives | Website leads | 16–30 Oct 2026`.
- Meta UI confirmed **A/B test published**; all three new ads show **Using test budget**.
- Measurement window: 16 October 2026 17:58 to 30 October 2026 00:00, Europe/London.
- Key metric: cost per result; the existing ad set optimises offsite conversions for Lead, pixel `25839137269022721`.
- Existing audience, bidding and attribution retained. The original ad set remains GB, age 25–65 settings, Advantage audience, seven-day click / one-day view / one-day engaged-video attribution.
- The existing successful ad remains in normal delivery. It is not a fourth randomized experiment cell; comparison against it is contextual, not a controlled causal test.
- Meta's budget wording is an **average aim across test ads**, not a hard £20 daily cap or promise of equal delivery. £50 is the configured campaign daily budget, not a guaranteed daily maximum charge.
- Meta explicitly says the **test schedule controls measurement only**. The ads follow the existing ad-set schedule and do not automatically stop when measurement ends.
- No budget increase or profitability claim is justified by this launch. Optimise for legitimate enquiries, qualified calls and captured revenue, not clicks alone.

## Creative and journey configuration

Source files: `/Users/jack/Documents/GitHub/uktl-ads-library/final-ads/Round1`.

Both images are 1440×1800. The supplied video is 1440×1800, approximately 30 seconds, H.264/AAC. Artwork and spoken content were reviewed before upload. Meta feed and story previews were visually inspected for each ad; padding preserves the image content instead of selecting the generated crop or AI-adjusted image. The video is ineligible for Facebook desktop right column because that placement requires an image; this is a placement limitation, not a publication error.

Identity is UK Trade Leads Facebook Page `810608108811524` and the available connected Instagram profile `uk.tradeleads` (`17841465747926292`). No new account permission or connection was granted. All ads use the existing destination:

`https://uktradeleads.com/free-website-page`

The new ads use one common primary text based on the existing short £197 copy. Changes clarify that the website build fee is included in the monthly package and replace a guaranteed-five-star-review phrase with an accurate review-request feature. Old inherited £297 text, extra primary-text options and headlines were removed from the new ads. Direct API readback confirmed identical primary text and no inherited body asset variants across all three.

**Headline:** Website + Leads For £197/Month

**Description:** £197/month. No setup fee. Cancel anytime.

**CTA:** Learn more.

Primary text:

> UK trade & home service business owners (builders, plumbers, landscapers, cleaners etc) ⤵️
>
> Forget having to...
>
> Rely on word-of-mouth
>
> Door knock
>
> Or cross your fingers hoping to get more jobs
>
> Instead, we build you a website with no build fee as part of our £197/month package.
>
> But that's just the beginning...
>
> We also add in our AI system, so you can:
>
> ✅ Automatically send text messages to calls you missed
>
> ✅ Automatically request Google reviews
>
> ✅ Nurture past clients for referrals and new jobs
>
> Plus so much more for just £197/month.
>
> No setup fee. Cancel anytime. 30-day money-back guarantee.
>
> 👉 Click 'Learn More' below to see exactly how this will work for your business.

Related-media publishing into existing ads was not selected. Generated imagery, animation, music, text improvements, translations, video effects and extra product imagery were opted out as applicable. Relevant comments remain enabled. Video subtitles remain enabled; their final delivered transcription has not been independently verified. Interactive website summaries and website-screenshot use were switched off in the UI. The API still returns `reveal_details_over_time: OPT_IN` at the feature level despite the UI's source selection being off; do not describe every underlying feature flag as disabled.

## Attribution and saved reporting

Existing UTMs were preserved and numeric identifiers appended on all three published creatives. Exact API readback confirmed:

```text
utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
```

The acquisition parser already understands numeric IDs in attribution URLs and validates them against the Meta catalogue. This configuration does **not** prove a new click has resolved its templates and persisted all three IDs through form submission, CRM, booking and payment.

The production dashboard Meta sync was refreshed after publication: run `cmvb819t20000w41l2e4zbp38`, SUCCEEDED, 668 rows fetched/written, 12 September–16 October. Saved-data readback confirmed all three new ad IDs and their original campaign/ad-set IDs among 29 catalogue rows, `metadataCurrent: true`, sync time `2026-10-16T17:08:46.444Z`. Performance remains unknown; saved review status can lag the later direct provider read. The sync reported 108 insight rows with unavailable website-inquiry results; these remain missing, not zero. The first urllib request was rejected by Cloudflare with HTTP403/1010; the subsequent Node fetch succeeded. No customer records or conversion senders were changed.

## Monitoring owner and next actions

Owner: this launch thread / its scheduled agent, with Jack making commercial continuation decisions.

Daily T3 review is enabled at **09:00 Europe/London**, first run **17 October 2026 08:00 UTC (09:00 BST)**. Task ID:

`scheduled-task:command:mcp:49eb31e4-6b8f-4301-8aaf-dc10b0906549:schedule-task:round1-ads-daily-review-20261016-v1`

The review checks approval, delivery, per-ad spend, lead quality and source coverage; it preserves the original control and £50 campaign budget. Keep the first 72 hours stable unless a concrete fault occurs. It may pause a new ad for a confirmed broken destination/wrong offer, rejection, or at least £100 spent with confirmed zero legitimate enquiries and complete source coverage. Missing Meta action fields alone are not a stop signal. Small samples are not proof of a winning ad.

At the 30 October review, or first successful run after it, reconcile results and pause only the three Round1 ads if no continuation decision exists, then disable this schedule. This is an operational follow-up dependent on scheduler and provider/browser access, **not a guaranteed hard spend stop**.

Known funnel work remains open from [the launch audit](AD_LAUNCH_AUDIT_2026-10-16.md):

1. Existing funnel Meta PageView/_fbp fires before advertising consent and after optional-analytics rejection. Repair the existing GHL integration with accept/reject/no-choice/withdrawal checks, preserving functional forms and existing event wiring; do not add another CAPI sender.
2. A fresh controlled form→contact→Lead and confirmed booking→Schedule journey remains unproved. The read-only review hit Turnstile error600010 in automation; that is not evidence all real visitors are blocked. Use an authorised consenting controlled journey, suppress sales outreach for the test identity, and verify actual Meta receipt/deduplication and CRM attribution.
3. Native booking trigger correctness and newly enabled native CAPI require acceptance evidence. A page visit is not a booked appointment.
4. The destination still contains unsupported quantitative outcome copy (including 2.3×); substantiate or correct it in the funnel owner workflow. Existing winning ad variants were deliberately not changed by this launch.

These issues are **not resolved by uploading new ads**, and launch does not mean every funnel risk was eliminated. Review legitimate enquiries before increasing spend.

## Subsequent pause review — 16 October 2026

After publication, Jack explicitly asked to pause existing ads worth removing. A fresh direct Meta read compared 9–15 October, 16 September–15 October, and 17 August–15 September with the same seven-day click / one-day view / one-day engaged-video attribution. All three Round1 ads now read back effective ACTIVE.

Four older ads were switched off in Ads Manager. The reason is an observable offer mismatch combined with weak recent evidence, **not a claim of confirmed zero enquiries**. Every body variant in the three videos still sells the package at £297/month, while their headlines/current destination promote £197. News Article also retains £297 offer variants. No creative was edited or deleted.

| Paused ad | Ad ID | Spend, 16 Sep–15 Oct | Reported landing-page views |
| --- | --- | --- | --- |
| Testimonial + B-Roll | `6914233553539` | £76.22 | 10 |
| Founder Story | `6914233842939` | £20.48 | 2 |
| Short Pitch - Outdoor Walking | `6893319538539` | £22.67 | 8 |
| News Article | `6929347785139` | £1.81 | 2 |

These four spent £121.18 in that 30-day period. Their period responses omit the website-lead action, so lead counts remain unavailable. Outdoor Walking previously reported two leads during 17 August–15 September; it is being parked for offer consistency, not declared permanently unsuccessful. Historical spend is not a forecast of savings: the £50 campaign budget remains unchanged and Meta can reallocate delivery.

The original £197 Price Lead ad remains ACTIVE (19 Meta-reported website leads from £989.11 in the latest complete 30-day window). Plain Text and AI Comparison also remain ACTIVE, with four reported leads each from £138.75 and £111.44 respectively. These are attributed Meta events, not verified paying customers. Tweet previously produced four reported leads in the preceding period and was retained; the other low-spend ads lack sufficient evidence for a performance-based pause.

Direct before/after comparison found exactly these four configured-status changes from ACTIVE to PAUSED, no creative-ID changes, and all other 25 ad statuses unchanged. Campaign `6890146663739` remains ACTIVE with `daily_budget: 5000`. All retained ads remain in original ad set `6890146663939`. Pauses can be reversed after correcting the offer and deciding to retest; the scheduled Round1 review must not reactivate these four automatically.

The preserved winning ad itself still contains legacy £297 body variants alongside its £197 variants. Preserving it was Jack's explicit launch requirement; this review does not claim all legacy offer inconsistencies are fixed. Correcting that control should be a separately measured change after the new test has a stable baseline.

Private evidence: `/tmp/uktl-round1-review/pause-audit-live.json`, `pause-before-creatives.json`, and `pause-after-readback.json`. The readback distinguishes configured PAUSED from a short-lived IN_PROCESS effective status while Meta applies a switch change. A subsequent refreshed Ads Manager view confirmed all four delivery states **Off**, with publication complete: [pause verification screenshot](evidence/round1-four-paused-2026-10-16.png).

The production dashboard Meta sync subsequently succeeded (`cmvb9s8wu0000sh1lxwfvvmay`, 671 rows written). Its 110 unavailable enquiry-result rows remain missing, not zero.

## Launch evidence

Provider responses and original review materials remain private under `/tmp/uktl-round1-review/`; credentials and person records are excluded from this repository. Publication screenshot: [four ads in Meta](evidence/round1-published-2026-10-16.png). The screenshot shows the earlier processing/review state; the table above records the later direct verification.
