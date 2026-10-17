# UKTL acquisition: start here in a new chat

Compiled **17 October 2026** from the spending-assessment conversation and the
repository's subsequent launch/review records. This is a handoff, not a live
account snapshot. No provider refresh was performed to compile it. Read newer
dated reviews and verify affected live settings before making a decision.

## Jack's question and commercial aim

Should UK Trade Leads invest more in Meta advertising or drop some ads, without
making an expensive mistake? Jack requested market research, paid-ads analysis,
online research and careful consideration of the existing tracking investigation.

Jack's own input: build/onboarding/ongoing incremental costs are “literally
nothing”; he wants advertising paid back in “a few months”. Use that as his
working cost estimate. Three months was the analyst's interpretation, not an
exact payback requirement supplied by Jack. Do not infer unlimited budget.

## Recommendation reached in this conversation

- Hold the existing **£50/day campaign budget** while testing the three already
  launched Round1 ads; do not scale yet or blanket-pause Meta.
- Preserve the original **£197 Direct Offer / Price Lead** control.
- Judge legitimate enquiries, qualified conversations, captured payments and
  cash recovery together. Meta CPL alone is not the business outcome.
- Proposed acquisition target: roughly **£350 per credibly acquired payer**;
  £350–£400 is a review band. This is advisory, not a target Jack approved or a
  setting written into the dashboard or scheduler.
- Three uninterrupted £197 payments total £591, but cancellations, collection
  failures, refunds and sales delay mean £591 is not a safe acquisition target.

This assessment changed no ads, budgets, tracking or schedules. Its report and
aggregate evidence were committed/pushed as `36c81f7`. Subsequent authorised
changes in the launch thread are recorded below; do not confuse the two scopes.

## Evidence behind the recommendation — dated 16 October

Spend is for the stated dates; customers are matched paying contacts created
within those dates, with payments observed by the saved snapshot. These are
**spend-per-identified-payer ratios, not exact causal ad-level CAC**.

| Contact-created period | Account spend | Recorded paid-Meta payers | Spend / identified payer |
| --- | ---: | ---: | ---: |
| January–June 2026 | £7,788.66 | 22 | £354.03 |
| July–September 2026 | £4,740.72 | 5 | £948.14 |
| 16 September–15 October | £1,474.81 | 2 | £737.41 |

The rolling window overlaps the other periods. It also had three unattributed
payers; do not assign them to Meta to improve the ratio. Sales lag and incomplete
attribution limit the inference, but the deterioration predates October's
tracking changes.

Twenty-seven recorded paid-Meta payers produced £16,403 net captured revenue,
including later renewals, against £13,259.55 January–15 October spend. Among 21
payers old enough to assess, average net receipts during the first 90 elapsed
days **after first payment** were £490.14. That clock starts later than ad spend;
the figure is not a guarantee of three-month acquisition payback or accounting
profit. Some histories include four billing dates within 90 days.

Meta snapshot: 16 October 17:08 UTC. Payment snapshot: 16 October 12:02 UTC.
There were 279 paid-Meta contacts without ad IDs and 54 unmatched charges.
See [full analysis](MARKET_RESEARCH.md) and [aggregate evidence](evidence/ad-spend-assessment-2026-10-16.json) for methods and caveats.

## Later evidence that supersedes parts of that assessment

The [launch record's subsequent pause review](ROUND1_AD_LAUNCH_2026-10-16.md#subsequent-pause-review--16-october-2026)
documents Jack-authorised pauses of four older ads:

- Testimonial + B-Roll — `6914233553539`.
- Founder Story — `6914233842939`.
- Short Pitch / Outdoor Walking — `6893319538539`.
- News Article — `6929347785139`.

They were paused for legacy £297 offer mismatches combined with weak recent
evidence, **not proven zero enquiries**. The campaign remained £50/day. Do not
automatically reactivate them or repeat their pauses as unfinished work.

**Plain Text is no longer a straightforward “first pause candidate”.** The later
direct report recorded four Meta Leads for Plain Text and four for AI Comparison
over 16 September–15 October; both were retained. It included one-day engaged-video
attribution, unlike the earlier saved dashboard view. Do not overwrite unknown
dashboard results with these counts or compare the windows as identical. Neither
count proves a paying customer. Reassess using consistent attribution and fresh
downstream evidence before pausing either.

The [17 October 09:00 BST review](ROUND1_REVIEW_2026-10-17.md) records:

- All three new ads and the control active; the four pauses preserved; £50/day.
- £13.11 combined new-ad spend through that morning, too little for a verdict.
- The first scheduled customer sync succeeded at 07:16 UTC.
- An overdue enquiry register was manually refreshed successfully. The cause
  of the missed scheduled window remained unresolved.
- Post-launch form/booking activity existed, but no new-ad numeric-ID customer
  attribution or matched payer outcome was established through that review.

These are the latest **repository review facts incorporated here**, not a claim
that no later provider events or chats exist. Refresh rather than extrapolate.

## Existing test, owner and next checks

Account `1357893439073996`; campaign `6890146663739`; ad set `6890146663939`.
Control: `6914088373739`. Round1 ads:

- We Build It You Own It — `52555243798943`.
- Stop Renting Leads — `52555243799143`.
- Wish I Found These Guys Sooner — `52555243799343`.

The documented test uses an average £20/day across the three new ads **within**
the £50/day campaign budget. Neither amount is a guaranteed daily charge cap.
The control is outside the randomized test cells.

**Owner:** the existing launch thread / its daily review agent; Jack decides
commercial continuation. Its documented 09:00 Europe/London schedule ID is:

`scheduled-task:command:mcp:49eb31e4-6b8f-4301-8aaf-dc10b0906549:schedule-task:round1-ads-daily-review-20261016-v1`

Verify the existing schedule and latest result before relying on it. Do not
create a second monitor just because this handoff is opened in another chat.

- **19 October:** first 72-hour review; confirm delivery, real capture,
  attribution and follow-up before declaring a creative winner.
- **23 October:** review qualified conversations and first payments against
  their acquisition cohort, allowing for documented sales lag.
- **30 October:** explicit continuation decision. The existing owner's default
  is to pause only the three Round1 ads if no continuation decision exists,
  then disable that review schedule. The Meta experiment end date ends
  measurement, not delivery; verify actual pauses. The control continues unless
  separately changed. If these dates have passed, recover the decisions first.

The existing new-ad stop guardrail is a confirmed destination/offer fault,
rejection, or £100 spent with confirmed zero legitimate enquiries and complete
source coverage. It is a cash-risk rule, not statistical proof; missing results
are not zero. Unknown attribution must not justify indefinite spending.

## Unresolved evidence and safeguards

Read [the acquisition journey](AD_TO_CUSTOMER_FLOW.md) before related work.
At this handoff's source dates, the remaining checks were:

1. A consenting controlled form → CRM → Meta journey with browser/server
   deduplication proved. GHL already sends events; do not add another sender.
2. A real accepted appointment → Schedule, rather than a thank-you-page visit.
3. Resolved new-ad campaign/ad-set/ad ID templates persisting through CRM and
   payment attribution. Templates were added to the three new ads only;
   configuration is not end-to-end proof.
4. Advertising-consent behaviour, genuine qualification/follow-up, call/SMS
   receipt, and the appointment attendance left open in the daily review.
5. Automatic register advancement after the manual recovery.

Lead meaning changed on **8 October** from booking-page views toward form
submissions; another CAPI connection was enabled on **16 October**. Treat these
as reporting boundaries. Domain permissions were verified Allowed; do not
assume a domain warning meant the site was blocked. Preserve the existing
HighLevel funnel and native senders while resolving the specific evidence gaps.

Keep Meta events, receipts, contacts, booked appointments, attended calls and
captured payments separate. Active ads, successful workflows and deployments
do not establish commercial outcomes. Research advice does not authorise a
budget increase, ad pause or customer communication; recover the applicable
user authorisation and existing owner scope before executing changes.

## Market conclusion to retain

The preferred buyer hypothesis is an established UK trade/home-service business
with capacity for more suitable work, existing marketing spend or enquiry flow,
and problems with shared leads or missed follow-up. No winning trade niche was
established. Competing public £99–£199 offers make “free website” alone a weak
distinction: test real ownership, enquiry recovery and demonstrable client value.
This is a hypothesis, not grounds to change targeting or pricing automatically.

## How a new chat should resume

1. Read this file, the journey, full assessment and latest dated Round1 review.
2. Verify current Meta budget/statuses, the latest saved-source timestamps,
   existing review owner and any later decisions. Use the
   [saved-data reader](../skills/uktl-meta-dashboard-data/SKILL.md); don't refresh
   providers merely to read saved reporting.
3. Address the next due decision or concrete evidence gap. Avoid repeating
   research, launching duplicate tests, reopening completed pauses or treating
   the historical ratios as today's performance.
4. Record new verified evidence in the owning review/journey and update this
   handoff if a recommendation, owner or decision changes. Keep dated originals.

**Copy into another chat:**

> Continue UKTL acquisition from `/Users/jack/Documents/GitHub/meta-ads-dashboard/docs/ACQUISITION_HANDOFF.md`.
> Read its linked journey and latest review, verify current evidence, and tell me
> the next useful action. Preserve existing owners and distinguish recommendations
> from actions already authorised or completed.

Source conversation: Codex `01a145d3-6b25-73d3-9334-f4295b9d2d3c`, T3
`1ec5cf8b-612d-4562-90fc-dc8c52c8d7e1` (ad-spend assessment).
Original attached investigation: T3 `6087c6d5-feb4-49ab-8737-a5181aca1aef`,
“Verify Meta Ads Dashboard Changes Live”. Repository/provider evidence outranks
lossy thread summaries.
