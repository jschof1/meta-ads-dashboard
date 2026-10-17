# UKTL: whether to increase Meta spend or pause ads

Assessment: **16 October 2026**. Owner of the spending decision: Jack. This is advice, not an instruction to an automation or evidence of changed advertising settings.

**Resuming this work? Read the [acquisition handoff](ACQUISITION_HANDOFF.md) first.**
Subsequent authorised pauses and a later attribution view changed parts of the
ad shortlist below. This original assessment is retained as dated evidence.

## Recommendation

**Do not increase the £50/day campaign budget yet. Continue the three creatives already launched as a bounded test, retain the £197 control, and review the customer economics before extending or scaling. Do not blanket-pause the account because Meta CPL changed.**

This is a commercial test: Jack will use it to decide whether the next advertising pound produces a paying customer whose collected payments recover acquisition cost within roughly three months. No extra dashboard, campaign or monitoring system is needed. Use the existing daily Round1 review and the current CRM/payment records.

Jack reports negligible incremental build/onboarding/service costs and wants advertising paid back in “a few months”. Three months is the working interpretation, not a newly approved contractual target. More customers are valuable when acquisition costs and collections support them; negligible delivery cost does not make unlimited acquisition spend worthwhile.

## Evidence and freshness

- Read the complete attached **Verify Meta Ads Dashboard Changes Live** thread, ID `6087c6d5-feb4-49ab-8737-a5181aca1aef`, including its tracking corrections and final flow reference.
- Read the live saved dashboard and acquisition endpoints, then reconciled aggregate customer/payment calculations against the latest successful production customer snapshot using read-only SQL.
- Meta performance snapshot: **16 October, 17:08:46 UTC**. Customer/payment snapshot: **16 October, 12:02:27 UTC**. Enquiry-register snapshot: **16 October, 17:45:31 UTC**.
- Direct Meta GET readback during this assessment: campaign `6890146663739` is ACTIVE with `daily_budget=5000` GBP minor units. All three Round1 ads are now effectively ACTIVE, alongside 11 existing active ads, in the same ad set. The older dashboard review statuses lag that direct read.
- Performance comparisons below exclude partial 16 October. Meta uses conversion-date reporting, seven-day click plus one-day view. The ad set also includes one-day engaged-video attribution; do not mix those totals.
- There are **279 paid-Meta-attributed contacts without individual ad IDs**, four unmatched Stripe customers and 54 unmatched charges. Qualification remains unconfigured. Missing ad-level results are unknown, not zero.
- The stored `paidMeta` flag was independently checked: all 27 matched paying contacts flagged paid Meta have first-touch `fb` or `ig`. This is recorded source attribution, not proof of incremental advertising causation or reliable individual-ad attribution.

The non-personal [aggregate evidence](evidence/ad-spend-assessment-2026-10-16.json) preserves the calculations, windows, source timestamps and direct budget/status readback used here.

## Customer economics: encouraging history, weaker recent acquisition

The numerator is all account advertising spend in the interval. The denominator is matched paying contacts **created in that interval**, with payments observed by the customer snapshot. These are diagnostic spend-per-identified-payer ratios, not exact causal CAC. Sales delays, imported contact dates and unmatched attribution can distort them.

| Contact-created period | Account spend | Identified paid-Meta payers | Spend / identified payer |
| --- | ---: | ---: | ---: |
| January–June | £7,788.66 | 22 | £354.03 |
| July–September | £4,740.72 | 5 | £948.14 |
| 16 September–15 October | £1,474.81 | 2 | £737.41 |
| 1 January–15 October | £13,259.55 | 27 | £491.09 |

The rolling 30-day interval overlaps the quarterly periods; do not add these rows. Its cohort also includes three unattributed paying contacts. Assigning those three to Meta would improve the apparent ratio, but there is no basis to do that. Recent non-payers can still convert: among the 27 known payers, median contact-created-to-first-payment delay was 4.2 days, with two over 30 days. This payer-only distribution does not predict when currently unpaid leads will buy.

The 27 recorded paid-Meta payers have produced **£16,403 captured revenue less refunds**, including later renewals. That is about 1.24 times year-to-date account spend. It supports continuing to investigate Meta, but is neither accounting profit nor proof of three-month payback.

I checked actual payment timing rather than estimating revenue from retention:

- **21 payers** had at least 90 elapsed days since their first captured payment.
- Their average captured revenue less refunds on charges in the first 90 days was **£490.14**; median **£591**.
- Some had only one or two payments; two had four billing dates inside 90 elapsed days. Historical prices/refunds vary. This is not exactly “three £197 invoices”. Refunds are deducted as observed now, not reconstructed by historical refund date.
- The clock starts at first payment, later than acquisition spend. This average therefore cannot guarantee cash recovery within 90 days of an ad click.
- Separately, 13 of 21 eligible subscription histories were retained at day 90. Subscription duration does not prove successful collection.

For context, the fully mature January–June contact cohorts produced **£10,096** on matched paid-Meta charges within 90 days of each contact's creation, against £7,788.66 advertising spend. This is an aggregate source-linked observation, subject to the same attribution and refund timing limits. It shows that earlier cohorts could work; it does not rescue recent acquisition costs.

**Working decision target: aim for £350 per verified acquired payer; treat £350–£400 as a review band, not an automatic scale signal.** This is a conservative management choice, not an industry benchmark or measured break-even threshold. £591 is merely three uninterrupted £197 payments before fees/refunds, not a safe acquisition target. Update the target when better mature-cohort evidence arrives.

At roughly £1,500 monthly advertising spend, five customers imply £300 each; four imply £375; three imply £500. Use customers credibly linked to that acquisition cohort, not any payment received in the month.

## What the advert figures actually say

The £197 control, `6914088373739`, had **£15.24 Meta CPL in February versus £26.66 in September**. CPM rose £19.77 → £39.33, while link CTR moved 1.115% → 0.948%. That deterioration predates October's tracking changes. More expensive impressions explain an important part of it; creative fatigue is not established.

For 16 September–15 October the control spent **£989.10 for 19 Meta Leads (£52.06)**, versus £1,068.08 for 43 (£24.84) in the preceding matched period. This comparison crosses the 8 October change from booking-page visits to form-submission Leads, so it cannot isolate performance deterioration. The new CAPI connection on 16 October introduces another measurement boundary.

The linked thread's completed-week check showed configured-form contacts rising from two to seven on almost unchanged spend, 1–7 versus 9–15 October. Those include sources beyond proven paid clicks and are too few for a reliable improvement claim. Equally, they do not establish a collapse caused by the tracking correction.

| Ad | Spend, 16 Sep–15 Oct | Recorded evidence | Recommendation |
| --- | ---: | --- | --- |
| £197 Direct Offer / Price Lead | £989.10 | 19 Meta Leads; 240 link clicks | Keep as the historical control; do not assume it is currently profitable. |
| Plain Text Direct Offer (`6929339201539`) | £138.75 | 32 link clicks; lead total unavailable | First secondary ad to reconcile and consider pausing. Unknown leads cannot establish zero enquiries. |
| AI Comparison (`6936461292139`) | £111.44 | 76 link clicks; lead total unavailable | Watch. Cheaper clicks are not proof of better customers. |
| Tweet (`6929348452739`) | £78.95 | 26 link clicks; lead total unavailable | Review after the higher-spend candidates; insufficient evidence for a confident verdict. |
| Testimonial + B-Roll (`6914233553539`) | £76.22 | 15 link clicks; lead total unavailable | Same: reconcile outcomes before calling it a loser. |
| Other six existing active ads combined | £80.35 | Limited spend and incomplete result fields | Low priority for savings; do not overinterpret a few clicks. |
| Three Round1 creatives | Not yet established by the saved performance snapshot | Launched 16 October; direct read now ACTIVE | Too early to assess; preserve the test. |

The ten old secondary ads together received **£485.71**, about 33% of account spend. Their importance is collective, but missing results prevent declaring that sum wasted. Pausing Plain Text at unchanged campaign budget reallocates spend; it does not guarantee a cash saving. Ads labelled TOF/MOF/BOF all sit in the same ad set, so names alone do not establish separate retargeting audiences.

## Market selection and customer pain

**Preferred next hypothesis:** established UK trade/home-service businesses with room for more suitable work, an existing marketing spend or flow of enquiries, and frustration with shared leads or missed follow-up. Examples include plumbers/heating engineers, electricians, roofers and pest-control operators. The account does not establish which trade has the best CAC or retention, so do not declare a winning trade or split the small budget into numerous trade-specific ad sets.

These directional scores are research judgement, not measured market statistics. “Growth” remains unverified rather than invented.

| Segment | Pain /10 | Ability to pay /10 | Reachability /10 | Growth evidence | Priority |
| --- | ---: | ---: | ---: | --- | --- |
| Established businesses paying for leads but unhappy with quality/control | 9 | 8 | 7 | Unverified | First hypothesis; connects to Stop Renting Leads. |
| Established businesses missing enquiries while working | 8 | 8 | 7 | Unverified | Strong next concept; show the actual recovery workflow. |
| New businesses seeking a free website with little demand/budget | 7 | 4 | 8 | Unverified | Qualify carefully; interest is not willingness to pay. |

**What online research supports:**

- [Checkatrade's own ROI guide](https://www.checkatrade.com/blog/grow-business/checkatrade-membership-roi/) describes paid memberships and emphasises lead quality, customer conversion and response times. This establishes a competing paid offer, not its profitability for every member.
- A [public electrician discussion](https://www.reddit.com/r/ukelectricians/comments/1j4emrs/checkatrade_wanting_150_a_month_for_4_leads/) includes the phrase “I'm not as busy as I'd like to be” and complaints about paying for shared enquiries and contract commitments. It is self-selected anecdotal pain evidence, not representative research, verified competitor pricing or valid probability calculations.
- [MyTradeSite](https://mytradesite.uk/) advertises £99/month with no setup fee and a website/Google/enquiry-management package. [Local Ladder](https://localadder.co.uk/) advertises websites and local SEO for established trades at £199/month. [Goodstanding](https://goodstanding.io/) advertises a website and call-handling package at £99/month after a free first month. These are observed public offers, not independently verified delivery or sales results.
- UKTL's own matched payments provide stronger evidence of willingness to pay than the mere existence of those competitors. They validate paying demand for UKTL overall, not a particular proposed micro-niche.

The surface problem is inconsistent or poorly handled enquiries. The deeper buying concern is paying another provider without seeing worthwhile work, or losing control over the customer relationship. Hypothesised concerns to verify in sales calls: “Will I actually use it?”, “Is this just another website bill?” and “What happens when I cancel?” These are interview prompts, not invented customer quotations.

**Positioning implication:** £197 is not self-evidently cheap against £99 competitors. Retain clear pricing and show why UKTL's wider setup earns the difference: a real customer journey, real missed-call handling, ownership, useful follow-up and verified client outcomes. Do not promise that a website alone will immediately replace a lead marketplace. Do not lower price or rebuild the offer solely because competitors advertise cheaper packages.

Buyers already value suitable work, can afford £197, have capacity and will engage with the setup. Browsers may like free design but avoid the monthly service or lack an active business. Qualification should establish trade/area, current enquiry source, capacity, problem and acceptance of £197/month. Avoid making the initial form unnecessarily long; recover these facts in the first conversation where practical.

## Bounded validation and spending plan

Use the existing [Round1 experiment and owner](ROUND1_AD_LAUNCH_2026-10-16.md). It already tests ownership, renting leads and a testimonial-style video under the same offer. The old £197 control is outside the randomized cells, so its comparison is contextual.

1. **Now to 19 October:** retain £50/day and the existing average £20/day allocation across the three test ads. Keep the first 72 hours stable unless there is a concrete fault. No new creative batch, platform, bid strategy or optimisation event is needed. Review delivery and contact outcomes daily through the existing owner.
2. **Within that window:** prove a consenting click/form/CRM journey, resolved ad IDs, one deduplicated Lead, and an accepted appointment rather than a page-based Schedule. Confirm real follow-up and usable contact details. The new ads already contain numeric-ID templates; persistence remains unproved. Existing consent defects and unsupported funnel claims remain owner actions in the launch record, not solved by new creatives. If a material destination/capture fault is confirmed, pause affected delivery until corrected.
3. **19 October review:** check evidence collection and genuine enquiries, not a premature winner. Do not allow “unknown attribution” to justify open-ended spending. Escalate missing capture/collection proof to the funnel owner before extending the test.
4. **23 October review:** compare legitimate enquiries, qualified conversations and first captured payments with their actual acquisition cohort. Verify follow-up on every genuine test enquiry. One payment is encouraging but too little to establish repeatability. Start pruning old secondary ads only with complete outcome evidence, or state explicitly that a pause is a budget-concentration choice rather than proof of inferiority.
5. **30 October continuation decision:** retain the documented default pause for the three new ads if no continuation decision exists. The test's UI end date only ends measurement; the existing scheduled owner must perform and verify any pause. The old control continues unless separately changed. Do not create a duplicate schedule.

At £50/day, another 13–14 days implies roughly **£650–£700 campaign exposure**, of which £260–£280 is the test's average allocation. These are planning amounts, not hard daily or lifetime caps. Actual delivery and Meta budgeting rules can vary. Track actual cumulative spend; do not silently extend the experiment to reach a desirable sample size.

The existing rule permits pausing a new ad after **£100 spent with confirmed zero legitimate enquiries and complete source coverage**, or for a confirmed wrong offer/broken destination/rejection. Treat £100 as a cash-risk guardrail, not statistical proof. With an assumed £50 genuine-enquiry cost, a simple Poisson model still gives about a 14% chance of no enquiry after £100; the actual account process need not follow that model. At £20/day spread equally, the three ads would not each reach £100 inside this test. Missing fields are not qualifying evidence of zero.

For the campaign as a whole, £650–£700 and two credibly acquired paying customers would suggest £325–£350 each; one suggests £650–£700. Allow a short, dated follow-up window for documented live opportunities and sales lag. Do not count unqualified pipeline as payment or extend unchanged spend indefinitely.

**Scaling gate:** establish repeatable, credibly attributed paying-customer acquisition around £350, with comparable mature cohorts supporting approximately three-month net-cash recovery. A practical first review sample is at least five payers in a defined cohort; that is still not statistical certainty. Check that the case survives removing the best single customer. If it does, consider £50 → £55/day first, changing one budget variable and reviewing new incremental results after seven complete days plus the observed sales lag. This is a proposed risk-control step, not a Meta guarantee or a change applied today. £400+ requires closer review; persistently weak or unverifiable acquisition calls for lower spend or a pause, not an automatic increase.

If no customer outcome emerges from the new angles, the next experiment should use the actual objections from sales calls and real product/client proof. It should not be another unbounded collection of images or a fake-door experiment when a real product and payment flow already exist.

## Current guidance and limits

[Meta Blueprint's Performance 5 guidance](https://www.facebookblueprint.com/student/path/253157-performance-5) supports account simplicity, creative diversification, data quality and results validation. That fits a small controlled test and better downstream evidence; it does not prove a particular allocation or CPL target. Some direct Meta help/developer pages were login- or rate-limited during research, so no universal “20% budget change is safe” rule is asserted.

[HighLevel's current CAPI documentation](https://help.gohighlevel.com/support/solutions/articles/48001185099) says its workflow reuses the browser event ID when available. This is a documented mechanism, not proof the current UKTL integrations deduplicate. The attached thread verified the domain Allowed; duplicate processing remains unconfirmed. Do not add a further sender as a shortcut.

An independent read-only review challenged the cohort comparisons, retention interpretation, small samples and test exposure. The analysis preserves those limitations. Figures were checked against saved APIs, the customer snapshot and direct campaign/status reads. No adverts, budgets, workflows, tracking settings, customer records or scheduled tasks were changed by this assessment.

Related reference: [current ad-to-customer flow](AD_TO_CUSTOMER_FLOW.md). That earlier document's proposed numeric IDs are superseded for the three new ads by the later Round1 launch record; the end-to-end attribution acceptance gap remains.
