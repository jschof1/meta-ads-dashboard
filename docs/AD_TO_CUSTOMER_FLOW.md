# UK Trade Leads: current ad-to-customer flow

Internal reference for Jack. Last checked **17 October 2026**, Europe/London.
This is a dated analysis, not an automatically updated status page.

## What happens today

Someone clicks a Meta advert and reaches the existing HighLevel landing page.
They can request a callback, move on to book a call, telephone the business or
start an SMS. A callback request and a booked appointment are separate actions;
neither proves a conversation, an attended appointment or a paying customer.

The dashboard now combines saved Meta, HighLevel and Stripe evidence. The main
gap is tracing a particular advert all the way to a genuine, qualified, paying
customer. Form capture has historical positive proof; call/SMS receipt and the
current browser/server conversion pairing still need a controlled live test.

**Evidence labels:** “16 Oct” means inspected that day; “historical” means a
previous dated test; “open” means not established; “proposed” means not applied.

## 1. Advert → website

- **Current setup, 17 Oct 09:00 BST:** one active Leads campaign, one active ad set and
  10 active adverts among 29 total, at a £50/day campaign budget. The optimisation event is
  **Lead**, using UK Trade Leads pixel `25839137269022721`.
- **Destination:** [free-website-page](https://uktradeleads.com/free-website-page).
  [free-website](https://uktradeleads.com/free-website) is an existing alternate
  route. The funnel remains on HighLevel; it has not been migrated.
- **Visitor choices:** request a callback, call, or send an SMS. The callback
  popup also has an exit trigger, restored and checked on 8 October.
- **Measurement:** Meta records ad delivery, clicks and available landing-page
  views. The website sends browser pixel events. Optional PostHog analytics
  records behaviour for visitors whose analytics choice permits it.

**Attribution gap:** the 26 original adverts inspected on 16 October lacked stable campaign,
ad set and ad IDs in URL tags. The three subsequently published Round1 ads include
those templates, verified at publication. Other attribution fields may still identify Meta as the source,
but reliable individual-ad customer attribution is incomplete. The customer
snapshot flags 279 Meta-attributed contacts without ad IDs across retained
history; these are not 279 newly lost enquiries.

**Applied to the three Round1 ads only:** stable IDs. Still open: prove they survive the actual
ad click, form, contact record and reporting join. Parameters are
`campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}`.
Their presence in an advert URL alone would not prove that HighLevel saves them.

**Offer gap:** the launch audit found £197/£297 and seven-day/two-week promises
across adverts and pages. Agree the intended offer and align the journey before
using conversion differences to judge new creative.

## 2. Website → callback request → CRM

1. The visitor opens the native callback form and enters name, phone and email.
2. HighLevel validates and accepts the submission, records the contact/form
   receipt, and redirects to [book-a-call](https://uktradeleads.com/book-a-call).
3. The accepted callback can send a browser **Lead** event. The existing native
   **Meta CAPI - Lead** workflow sends the server-side Lead from a **Form
   Submitted** trigger filtered to **UK Trade Leads LEAD FORM**.
4. Booking is the next available action. A person can request a callback and
   leave without booking anything.

**Historical proof, 8 Oct:** a valid callback returned HTTP 201, preserved the
test campaign parameters on redirect, emitted browser Lead with an event ID,
and reached the native server action with Success. An empty submission was
blocked and produced no observed Lead. The positive navigation capture was
truncated, so it did not establish an exhaustive event count or deduplication.

**Current negative check, 16 Oct:** directly visiting `/book-a-call` produced
ViewContent and PageView, with no Lead observed. Merely opening this page should
not be treated as a new enquiry.

**Counting:** the enquiry register uses one HighLevel contact ID per person-row.
Repeated submissions, including another form on the booking page, remain
separate receipts under that contact. Contact-ID counting does not establish
that every row is a unique human across duplicate CRM records. Explicit
`uktl-tracking-test` records are excluded; untagged tests/spam are not guaranteed
to have been identified.

**Open:** a new full mobile submission and a fresh end-to-end browser/server
Lead test after today's Meta connection change. Mobile popup layout passed
inspection, but automated Turnstile error `600010` prevented a delivery test.

## 3. Booking page → appointment → confirmation

The booking page offers the HighLevel calendar. Its configured redirect is
[thank-you?booked=1](https://uktradeleads.com/thank-you?booked=1). The page also
offers the callback form and telephone route, so arriving there does not mean
the calendar was used.

- A saved calendar appointment is booking evidence. Calendar status, the time
  booked and the appointment date answer different questions.
- A confirmation-page visit is weaker evidence: the current HTML contains a
  browser **Schedule** call protected by a query/session guard. That guard does
  not itself prove a provider-accepted appointment.
- **Historical, 14 Oct:** native **Meta CAPI - Book a Call** used a known-contact
  view of the VSL thank-you page as its Schedule trigger; an appointment was not
  required. Its workflow remains published, but the internal trigger was not
  freshly verified on 16 October. No correction is claimed here.
- **Historical:** a controlled booking and confirmation-email inbox receipt were
  verified earlier. That test appointment was subsequently cancelled. SMS
  delivery and an attended appointment were not established by that test.

**Reporting implication:** Schedule totals can include page-based signals rather
than genuine bookings. Use calendar records for booking counts while acceptance
is open. Neither a booking nor a Schedule event proves attendance or a sale.

**Proposed:** tie Schedule to a genuine accepted appointment and verify one
browser/server business event per booking, including cancellation behaviour.

## 4. Telephone and SMS routes

Public link targets were checked in the live page HTML on 16 October:

- **Call:** `0808 502 2740` through a `tel:` link on the landing/booking pages.
- **SMS:** `07897 037404` through `sms:` links on the landing page; one variant
  pre-fills “UK Trade Lead Enquiry”. This opens the visitor's messaging app.

A click only shows intent. It does not prove the dialler completed a call, the
business answered, an SMS was sent/delivered, or a CRM enquiry was recorded.
Destination ownership, actual handset receipt and how these routes create or
match CRM records remain **open**. No WhatsApp route was established in this
inspection.

**Next proof:** one agreed call and SMS, checked at the receiving handset and in
the CRM. Record answered/missed status, reply/follow-up owner and source. A
working link or a successful workflow execution alone is insufficient.

## 5. CRM follow-up → qualified / attended → customer

HighLevel is the source for the contact, form receipt, appointment and subsequent
conversation/workflow history. A form receipt does not establish that follow-up
reached the person or that the person is suitable for the service.

The dashboard has places for contacted, qualified, booked, attended and won
outcomes. Qualification mapping remains unconfigured, and attendance evidence
is incomplete. Missing outcomes must remain unknown rather than being presented
as zero or inferred from a tag/page view.

The useful operational record is: who owns follow-up, whether a real conversation
happened, whether the lead qualified, whether the appointment happened, and the
next action. This analysis does not establish a new automatic follow-up cadence
or prove that every existing lead has received one.

## 6. Stripe payment / subscription → dashboard

**Live on 16 Oct:** the private dashboard reads HighLevel and the verified UKTL
Stripe account through restricted read access. It joins explicit identifiers and
verified metadata; it does not guess customer identity from similar names,
amounts or payment dates. It creates no charges or subscriptions.

- The first saved customer refresh completed at **12:02:27 UTC on 16 Oct**,
  reading 2,715 CRM contacts, 392 charges and 71 subscriptions. These are source
  coverage totals, not newly acquired customers.
- Coverage warnings: four unmatched Stripe customers, 54 unmatched charges,
  279 Meta-attributed contacts without ad IDs, and one non-GBP payment excluded
  from GBP revenue. Zero ambiguous matches were accepted.
- Captured payments and refunds inform collected revenue. Failed/uncaptured
  payments are not revenue; repeat subscription payments are not new customers.
- Cohort revenue can include later observed renewals for contacts created in the
  selected period. It is not necessarily cash collected during that same period.
- Source-level acquisition is usable. Individual-ad customer acquisition cost
  remains incomplete until identity and attribution coverage are established.

Jack approved **rolling 30-day customer snapshot history**. This limits the age
of saved snapshots, not the age of the source customers/payments inside a fresh
snapshot, and is not a blanket 30-day CRM deletion policy. Backup retention is
separate.

Saved dashboard reads do not refresh the providers. Meta refresh is scheduled
daily at 06:00 UTC; the enquiry register hourly at :45; customer reporting daily
at 07:15 UTC. The first genuine scheduled customer run **succeeded on 17 Oct**,
starting at 07:15:23 UTC and completing at 07:16:23 UTC. Its saved payload contains
2,715 contacts, 394 charges and 71 subscriptions: coverage counts, not new customers.
Check each source's timestamp
before comparing figures.

Private dashboard: <https://uktl-meta-dashboard.jackschofield1.workers.dev/>.

## Tracking changes that affect interpretation

### 8 October: Lead became closer to an actual form submission

Previously, opening `/book-a-call` could produce Lead, including through the
server workflow. The published corrections changed the browser URL rule to
**ViewContent** and the native server Lead trigger to the configured form
submission. They retained the existing funnel, pixel and native server action.

This creates a break in the meaning of reported Lead. Fewer Lead events or a
higher CPL across that boundary can reflect removal of page-view conversions,
without an equivalent fall in genuine enquiries. It does not retrospectively
clean old figures or explain deterioration months before the change. Other
page/copy fixes happened too, so the effect cannot be isolated from totals alone.

A saved-data comparison of complete days **1–7 Oct versus 9–15 Oct**, excluding
the change day and partial 16 Oct, found spend **£338.45 → £342.01**, Meta Leads
**4 → 5**, and distinct configured-form contacts **2 → 7**. This small sample
does not demonstrate a post-change collapse or prove improved advertising.
The CRM contacts include sources beyond verified paid clicks. Comparison scope:
account, Europe/London, seven-day click plus one-day view.

### 16 October: new Meta connection enabled; acceptance still open

Meta History records **Conversions API with Meta enabled at 15:59 BST**.
Settings subsequently showed Connected/Active, but the last server event was
received **one day earlier**. That establishes an existing server-event stream,
not successful delivery through today's newly enabled connection.

The Lead detail panel still said **“Still parsing your data”** for deduplication.
Its 18 Sep–15 Oct view showed 81 received events: 49 browser and 32 server, with
9.3/10 match quality. These are received events, not 81 unique people or 81
attributed ad conversions. Match quality does not prove deduplication.

Traffic permissions showed **uktradeleads.com Allowed**, with events in the last
hour at inspection around 16:05 BST. No allowlist existed. The domain diagnostic
did not mean the site was blocked. Creating an allowlist restricts other domains;
review all legitimate senders before using it just to clear a warning.

### Analytics choice does not currently control all advertising tracking

The 8 Oct work kept optional PostHog analytics off until opt-in and moved its
settings control into the paid landing-page footer. **That control does not gate
HighLevel's inline Meta pixel.** The 16 Oct audit reproduced Meta PageView and
`_fbp` before a choice and after optional analytics rejection. Advertising choice
needs a separate, verified browser/server implementation; it is not complete.

## How to read the numbers without mixing stages

- **Link click:** an ad interaction; not necessarily a loaded page or a person.
- **Landing-page view:** a measured page load; not an enquiry.
- **Meta Lead:** a conversion event under Meta's reporting rules; not necessarily
  one distinct CRM person. Browser/server deduplication still needs proof.
- **Form receipt:** one submission; the same contact can submit several times.
- **Configured-form contact:** one CRM contact ID with qualifying form evidence;
  not automatically a qualified lead, paid ad acquisition or unique human.
- **Appointment:** a calendar record; confirmed is not attended. Appointment-date
  totals cannot be used as the booking rate of a contact-created cohort.
- **Call/SMS click:** intent; not connection or delivery.
- **Paid customer:** a matched customer with captured payment evidence; repeat
  charges must not inflate the new-customer count.

Meta attribution also differs by view: the dashboard uses seven-day click plus
one-day view; the current ad set additionally includes one-day engaged-video
view. Align reporting settings before comparing totals. Do not change campaign
attribution merely to make reports agree. Missing daily Meta values are unknown,
not invented zeroes; consult the dated launch audit for period-total caveats.

## Next actions, in priority order

Owner for coordination: **Jack / this dashboard delivery thread**. These are
open actions, not changes implemented by writing this reference.

1. **Accept the current Lead journey.** Use one agreed, tagged test identity;
   prevent unintended sales outreach; submit once from a normal mobile/in-app
   browser. Trace the CRM receipt, browser event ID, server event ID/sender and
   Meta receipt. Prove one counted Lead, including today's new connection. Keep
   existing native senders until their overlap is understood.
2. **Correct advertising choice and booking events.** Verify browser and server
   behaviour on accept/reject, and make Schedule represent an actual appointment.
   Preserve the working functional form and calendar.
3. **Carry stable ad IDs end to end.** Validate one resolved real-ad journey
   before applying URL tags broadly or relying on ad-level customer economics.
4. **Prove call/SMS receipt and follow-up.** Confirm routing, CRM capture and an
   accountable next action for missed calls/messages.
5. **Close reporting acceptance.** The 17 Oct scheduled customer run succeeded;
   agree qualification/attendance mappings; investigate payment-join warnings;
   align offer copy before launching the next creative batch or increasing spend.

Do not wait for perfect historical attribution to follow up genuine enquiries.
Use verified CRM/contact evidence for today's sales work while closing these
measurement gaps.

## Supporting evidence

- [17 October Round1 delivery and CRM review](ROUND1_REVIEW_2026-10-17.md): current
  ads verified, missed register window manually refreshed, new and returning form
  contacts distinguished. The refresh does not prove the hourly schedule is repaired.

- [16 October advertising and tracking audit](AD_LAUNCH_AUDIT_2026-10-16.md)
- [16 October release and live acceptance, including later activation updates](LIVE_ACCEPTANCE_2026-10-16.md)
- [14 October customer-acquisition and workflow audit](CUSTOMER_ACQUISITION_AUDIT_2026-10-14.md)
- [Customer reporting release and outstanding acceptance](CUSTOMER_ACQUISITION_RELEASE.md)
- [Enquiry register definitions and refresh behaviour](LEAD_REGISTER.md)
- Original 8 Oct test report, local archive:
  `/Users/jack/Documents/Codex/2026-10-08/do-you-x20/outputs/free-website-remaining-fixes-report.md`.
- 16 Oct public-page HTML inspection and signed-in Meta Events Manager inspection
  in this delivery thread supply the later link-target, connection, deduplication
  and traffic-permission observations above. No new test lead, booking, call,
  message, payment or tracking-setting change was made for this reference.
