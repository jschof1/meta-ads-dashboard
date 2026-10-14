---
name: uktl-meta-dashboard-data
description: Open and read the UK Trade Leads Meta dashboard, report saved ad performance and enquiries, export data, and check sync freshness or HighLevel quota. Use for UKTL dashboard access and data questions across chats.
---

# UKTL Meta dashboard data

Help Jack access the dashboard from any device and turn its saved data into useful answers. The live app is [UKTL Meta dashboard](https://uktl-meta-dashboard.jackschofield1.workers.dev/); the source is [jschof1/meta-ads-dashboard](https://github.com/jschof1/meta-ads-dashboard). Cloudflare Worker `uktl-meta-dashboard` runs the app and schedules. Turso/libSQL stores the durable data. The live app works independently of Jack's Mac.

## Open or read

- To open the dashboard, use `open_in_codex` with the live URL, or provide the link. Use an existing authenticated browser session when available. Do not print the password or put it in a URL.
- Use `scripts/dashboard.mjs` with **Node 20+** for data. It uses the authenticated live API and built-in Node modules; no checkout, npm install, Turso token or provider refresh is needed for saved reads.
- Resolve the script relative to this `SKILL.md`. The examples below assume the current directory is this skill folder. On Jack's Mac it is installed at `~/.codex/skills/uktl-meta-dashboard-data/`.

```sh
node scripts/dashboard.mjs links
node scripts/dashboard.mjs status
node scripts/dashboard.mjs ads --period 7d
node scripts/dashboard.mjs ads --period 30d --active-only
node scripts/dashboard.mjs enquiries --days 30
node scripts/dashboard.mjs enquiries --days 7 --details
node scripts/dashboard.mjs quota
node scripts/dashboard.mjs ads --period 14d --format csv --out /private/path/ads.csv
```

| Request | Command / interpretation |
| --- | --- |
| Where is it / open it | `links`, then open the live URL |
| How are the ads doing | `ads --period 7d`, using totals, matched comparison and selected-period warnings |
| Show enquiries / bookings | `enquiries`; add `--details` when contact names and IDs are needed |
| Is it syncing | `status` first; `quota` if a provider check is needed |
| Export / download | `--out` writes a new JSON file with mode 0600; CSV supports ads or enquiries with `--details` |

JSON is the default. Return a concise answer with relevant links, source timestamps, the reporting period and uncertainty. Do not paste large JSON unless requested. CSV rows include source timestamps; retain JSON status and warnings beside the CSV when analysing it.

## Credentials and remote use

Run `secret --list` first. Use project credentials from the helper if available; do not read `~/.env`. The current helper lacks these project keys. The owner-only fallback is `~/.config/uktl-meta-dashboard/production.json`; the reader checks ownership and mode on Unix. It never prints credential values or persists its session cookie.

For another machine, copy this skill folder into that host's Codex skills directory and supply an authorised password through a secret manager's `UKTL_DASHBOARD_PASSWORD` environment variable, or a private JSON file passed with `--config`. A password-only file is enough for `status`, `ads` and `enquiries`: privately use `{"DASHBOARD_PASSWORD":"YOUR_PRIVATE_VALUE"}`, never in Git/chat. `UKTL_DASHBOARD_CONFIG` selects a different file without changing the command. On Windows restrict the file using account ACLs.

`quota` additionally needs `HIGHLEVEL_TOKEN` and `HIGHLEVEL_LOCATION_ID` in the private file. It reads the saved register first, makes exactly one lightweight contact request, reports rate-limit headers and discards the body. It performs no retries or fresh completeness comparison. Zero daily quota means skip further provider requests. A short-limit 429 with positive daily quota differs from daily exhaustion; report the distinction.

## Interpret the data

- Saved reads do not call Meta or HighLevel. Check Meta's last successful sync and latest attempt, and the register's saved timestamp, separately. The register flags a missed hourly :45 UTC window after a 10-minute grace period. Advancement across a scheduled window is evidence of advancement; registered cron or HTTP 200 alone is insufficient.
- Meta periods are account-local calendar days including today; today's data may be incomplete. Do not describe them as completed-day audits. `null` is unavailable, `0` is observed zero. Preserve selected-period warnings and stale metadata. MTD comparison is withheld when the prior month lacks a matching elapsed day.
- Enquiry windows end at the saved timestamp and exclude explicit `uktl-tracking-test` records. People, receipts, newly created contacts and appointment events are separate cohorts. All-time retained entries are not new leads. Show form-attributed contacts without receipts separately.
- Stage-based HighLevel CRM sync is separate from the hourly register import. Disabled stage-based sync does not mean the register is disabled. A booking is not attendance or payment; tags do not prove a reply; Meta Lead events are not unique form people. Customer/ad-attribution claims need actual person/payment/provider joins.
- The reader allows saved GET routes plus authentication only. It never refreshes data, changes ads/CRM, sends messages or deploys. Requests for those actions have their own scope; this skill does not grant it.

## Deeper source checks

Read [references/data-map.md](references/data-map.md) when a saved answer is insufficient. The retained `scripts/status.mjs` queries Turso aggregates and `scripts/audit-register.mjs` performs a broader live HighLevel reconciliation; these advanced helpers require the Mac checkout and owner config and consume provider quota. Use them when direct evidence is needed, after the lightweight quota check. Inspect current schema/config before relying on historical setup notes. Report partial reads as incomplete, never as a valid zero.
