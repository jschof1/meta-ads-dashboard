# UKTL acquisition journey reference

Before working on UKTL adverts, landing pages, forms, bookings, phone/SMS routes,
CRM attribution, conversion tracking or acquisition reporting, read
[the ad-to-customer flow](docs/AD_TO_CUSTOMER_FLOW.md). It explains the existing
journey, tracking changes, reporting definitions and outstanding evidence gaps.

For advertising spend, creative tests, pause/scale decisions or resuming the
acquisition discussion, also read [the acquisition handoff](docs/ACQUISITION_HANDOFF.md).
It records Jack's commercial inputs, dated recommendations, subsequent changes,
the existing review owner and next checks. Read the latest linked review before
acting; historical advice is not a new execution instruction.

- Treat the reference as dated evidence, not automatically current provider
  state. Verify the affected behaviour against the live system before changing
  it or claiming it works. Follow its supporting audit/release links as needed.
- Keep Meta events, form receipts, CRM contacts, calendar bookings, attended
  calls and captured payments distinct. A page view, click or successful
  workflow action does not prove an enquiry, receipt, attendance or sale.
- Preserve the existing HighLevel funnel and native conversion senders unless
  the task explicitly requires changing them. Check sender overlap and
  deduplication before adding another conversion path.
- After a verified change to the journey or its measurement, update the relevant
  sections of the reference in the same delivery. Date the evidence and separate
  implemented/live behaviour from historical tests, proposals and open checks.
  Never mark a gap resolved based only on configuration or deployment.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
