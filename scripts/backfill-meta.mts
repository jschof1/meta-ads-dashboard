import { syncMeta } from "../lib/sync";
import { isDateInRange } from "../lib/periods";
import { prisma } from "../lib/db";

// Credentials come from the existing secure runtime environment. Never log them.
// Without --apply this prints a plan and never constructs a provider client.
const args = process.argv.slice(2);
const arg = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const since = arg("since") ?? "2026-01-01", until = arg("until");
if (!until || since < "2026-01-01" || !isDateInRange(since, { since, until }) || !isDateInRange(until, { since, until }) || until > new Date().toISOString().slice(0, 10)) throw new Error("Use --since=YYYY-MM-DD --until=YYYY-MM-DD within 2026 onwards and today");
const months: { since: string; until: string }[] = [];
for (let start = since; start <= until;) {
  const next = new Date(`${start.slice(0, 7)}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  const end = new Date(+next - 86_400_000).toISOString().slice(0, 10);
  months.push({ since: start, until: end < until ? end : until });
  start = next.toISOString().slice(0, 10);
}
console.log(JSON.stringify({ action: args.includes("--apply") ? "apply" : "plan", scope: "existing Meta account", levels: ["account", "campaign", "adset", "ad"], months }));
if (args.includes("--apply")) {
  if (process.env.META_HISTORY_APPLY_APPROVED !== "yes") throw new Error("Historical writes require META_HISTORY_APPLY_APPROVED=yes after release approval");
  if (process.env.META_CAMPAIGN_ID) throw new Error("Account-wide history requires account scope");
  try { for (const range of months) console.log(JSON.stringify(await syncMeta({ range, trigger: "manual" }))); }
  finally { await prisma.$disconnect(); }
}
