import { createMetaClient } from "../lib/meta.ts";
import { isDateInRange } from "../lib/periods.ts";
import { MONTHLY_HISTORY_START } from "../lib/monthly-performance.ts";
import { syncMeta } from "../lib/sync.ts";
import { prisma } from "../lib/db.ts";
import { UKTL_META_ACCOUNT } from "../lib/customer-journey.ts";

// The existing operator command now plans by default, without credentials or
// provider calls. Explicitly approved imports reuse the same atomic writer in
// bounded monthly requests; the normal cron keeps its recent-day window.
const args = process.argv.slice(2);
if (args.some(a => !/^(--apply|--since=\d{4}-\d{2}-\d{2}|--until=\d{4}-\d{2}-\d{2})$/.test(a))) throw new Error("Use --since=YYYY-MM-DD --until=YYYY-MM-DD and optional --apply");
const arg = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const since = arg("since") ?? MONTHLY_HISTORY_START;
const until = arg("until") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
if (since < MONTHLY_HISTORY_START || !isDateInRange(since, { since, until }) || !isDateInRange(until, { since, until }) || until > new Date().toISOString().slice(0, 10)) throw new Error("Choose valid dates from November 2025 through today");
const months = [];
for (let start = since; start <= until;) {
  const next = new Date(`${start.slice(0, 7)}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = new Date(+next - 86_400_000).toISOString().slice(0, 10);
  months.push({ since: start, until: end < until ? end : until });
  start = next.toISOString().slice(0, 10);
}
console.info(JSON.stringify({ action: args.includes("--apply") ? "apply" : "plan", accountId: UKTL_META_ACCOUNT, levels: ["account", "campaign", "adset", "ad"], months }));
if (args.includes("--apply")) {
  if (process.env.META_HISTORY_APPLY_APPROVED !== "yes") throw new Error("Historical writes require META_HISTORY_APPLY_APPROVED=yes after release approval");
  if (process.env.META_CAMPAIGN_ID) throw new Error("Account-wide history requires account scope");
  const client = createMetaClient();
  try {
    const account = await client.getAccount();
    if (account.id !== UKTL_META_ACCOUNT || account.currency !== "GBP") throw new Error("Historical import requires the verified UKTL GBP account");
    for (const range of months) console.info(JSON.stringify(await syncMeta({ client, range, trigger: "manual" })));
  } finally { await prisma.$disconnect(); }
}
