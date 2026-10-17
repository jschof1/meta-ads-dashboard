# Round1 daily review — 17 October 2026, 09:00 BST

Decision: continue unchanged. All three new ads and the original £197 winner are
configured/effective ACTIVE in campaign `6890146663739`, ad set `6890146663939`.
Campaign budget remains £50/day. No rejection or issue was returned for the new
ads. The four older ads paused yesterday remain PAUSED. No advertising settings,
conversion senders or customer communications were changed by this review.

## Direct Meta delivery

Observed 08:00:36 UTC. Insights use conversion-date reporting, seven-day click,
one-day view and one-day engaged-video attribution, matching the current ad set.
16 October is complete; 17 October is partial. No missing action is filled as zero.

| New ad | ID | 16 Oct spend | 17 Oct spend so far | Total | Impressions total |
| --- | --- | ---: | ---: | ---: | ---: |
| We Build It You Own It | 52555243798943 | £3.11 | £1.55 | £4.66 | 82 |
| Stop Renting Leads | 52555243799143 | £2.23 | £1.44 | £3.67 | 77 |
| Wish I Found These Guys Sooner | 52555243799343 | £2.59 | £2.19 | £4.78 | 69 |

Combined new-ad spend: **£13.11**. Their website-Lead action is absent, so reported
lead totals remain unavailable. None is near the £100 pause guardrail. The first
72 hours have not elapsed. Unequal early delivery does not establish a winner.

The original winner spent £35.14 yesterday and £5.95 today, with one Meta-reported
website Lead today. This is not independently matched to a particular CRM person.
All ad spend in this campaign totals £54.07 yesterday and £11.72 today so far;
£50 is the configured daily budget, not a guaranteed daily billing cap.

## Landing and downstream evidence

The actual destination `https://uktradeleads.com/free-website-page` returned HTTP
200 without redirect in 0.45 seconds. Retrieved HTML contains the expected £197
offer, callback CTA and correct page title. This availability check is not a new
interactive form, calendar or browser/server acceptance test.

The Meta scheduled sync succeeded at 06:00:57 UTC. The scheduled customer snapshot
succeeded at 07:16:23 UTC (run `cmvc2axx00000011lsh9vnhss`). It contains 2,715
contacts, 394 charges and 71 subscriptions. No saved contact is attributed by ID
to a new Round1 ad. Two charges after launch were failed attempts for existing
customers, with zero collected; they are not new sales or Round1 revenue. No
post-launch captured payment is established through that snapshot's timestamp.

At 08:00 UTC the register was overdue: latest successful snapshot 06:45:22 UTC,
missing the expected 07:45 window. A lightweight HighLevel check returned HTTP200
and 114,373 daily requests remaining. One existing register refresh was run; it
completed successfully and its saved payload advanced to **08:01:28 UTC**, 2,132
entries. No duplicate schedule was created. The missed window's cause remains
unresolved; next review should verify scheduled advancement, not assume repaired.

The refreshed register has three post-launch form receipts across **two contact
records**, excluding explicit tracking-test records:

- A returning contact originally created in June submitted the landing form at
  05:10 BST and booking-page form at 05:12 BST today. Its sales-calendar record is
  confirmed for **17 October at 15:00 BST**. This is a booking, not attendance.
- One new contact was created at 08:45 BST today and has a landing-page form
  receipt at 08:46 BST. No saved appointment is attached.

Direct contact readback shows the original winner's name in both latest-touch
`utm_content` values, with Facebook Stories/calendar and Facebook Mobile Reels/form
respectively. Native ad IDs remain null. The returning contact's first touch names
the historical Founder Story ad. These named UTMs support a connection to the
control but do not prove causal attribution or a numeric-ID journey. Neither is
linked to the new Round1 ads. Qualification, human follow-up receipt and genuine
customer intent are not established by forms or tags. No messages were sent.

## Outstanding owner actions

Existing daily review remains the owner, next due 18 October at 09:00 BST. Preserve
£50/day, the average £20/day allocation across the new creatives, and the original
winner. Check automatic register advancement and whether the confirmed appointment
was attended at the next review. Keep the 19/23/30 October decision points from the
market assessment; the default 30 October pause applies only to the three new ads
unless Jack explicitly continues them.

Consent, native CAPI acceptance/deduplication, Schedule trigger correctness and
resolved new-ad-ID persistence remain open. No evidence here qualifies for a pause
under the scheduled review's rules. A matched payer outcome is still unproved.

Private source responses are under `/tmp/round1-*-2026-10-17.json`; no personal
contact details or credentials are included in this report. Direct Meta responses,
fresh saved CRM receipts and direct contact attribution outrank earlier dashboard
snapshots. The contact read initially failed through Python urllib, then succeeded
through Node fetch; partial failures were not counted as zero outcomes.
