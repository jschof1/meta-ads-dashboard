import assert from "node:assert/strict";
import { createMetaClient } from "../lib/meta.ts";
import { accountLocalDate, chooseSyncRange } from "../lib/periods.ts";
import { MONTHLY_HISTORY_START } from "../lib/monthly-performance.ts";
import { syncMeta } from "../lib/sync.ts";
import { prisma } from "../lib/db.ts";

// A deliberate operator action. The normal cron keeps its recent-day window.
const client = createMetaClient();
try {
  const account = await client.getAccount();
  assert.equal(account.currency, "GBP", "Historical import must use the configured UKTL reporting currency");
  const now = new Date();
  const today = accountLocalDate(now, account.timezone_name || "UTC");
  const days = (Date.parse(today) - Date.parse(MONTHLY_HISTORY_START)) / 86400000 + 1;
  assert.ok(Number.isInteger(days) && days > 0, "History baseline must not be in the future");
  const range = chooseSyncRange({ timeZone: account.timezone_name || "UTC", now, hasSuccessfulSync: true, recentRefreshDays: days });
  assert.equal(range.since, MONTHLY_HISTORY_START);
  console.info("Importing saved Meta history", { since: range.since, until: range.until });
  const result = await syncMeta({ client, now, recentRefreshDays: days, initialBackfillDays: days, leaseSeconds: 3600 });
  console.info("Historical Meta import completed", result);
} finally {
  await prisma.$disconnect();
}
