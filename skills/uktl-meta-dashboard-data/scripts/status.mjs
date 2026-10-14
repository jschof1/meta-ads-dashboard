#!/usr/bin/env node
// Read-only, aggregate operational status. No provider calls or personal data output.
import fs from "node:fs";
import { createRequire } from "node:module";

const repo = "/Users/jack/Documents/GitHub/meta-ads-dashboard";
const configPath = "/Users/jack/.config/uktl-meta-dashboard/production.json";
const stat = fs.statSync(configPath);
if (stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error("Production config must be owned by this user and have no group/world access");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (!config.TURSO_DATABASE_URL || !config.TURSO_AUTH_TOKEN || !config.HIGHLEVEL_LOCATION_ID) throw new Error("Production database settings unavailable");
const require = createRequire(`${repo}/package.json`);
const { createClient } = require("@libsql/client");
const database = createClient({ url: config.TURSO_DATABASE_URL, authToken: config.TURSO_AUTH_TOKEN });
const read = async (sql, args = []) => (await database.execute({ sql, args })).rows;
const inWindow = (value, start, end) => {
  const t = Date.parse(value);
  return Number.isFinite(t) && t >= start && t <= end;
};

try {
  const [saved, metaRuns, crmRuns, insights] = await Promise.all([
    read("SELECT checkedAt, payload FROM LeadRegisterSnapshot WHERE locationId = ?", [config.HIGHLEVEL_LOCATION_ID]),
    read("SELECT status, trigger, startedAt, finishedAt, requestedSince, requestedUntil, rowsWritten, warning IS NOT NULL AS hasWarning, error IS NOT NULL AS hasError, attributionKey FROM SyncRun ORDER BY startedAt DESC LIMIT 5"),
    read("SELECT status, trigger, startedAt, finishedAt, contactsWritten, opportunitiesWritten, warning IS NOT NULL AS hasWarning, error IS NOT NULL AS hasError FROM CrmSyncRun WHERE locationId = ? ORDER BY startedAt DESC LIMIT 3", [config.HIGHLEVEL_LOCATION_ID]),
    read("SELECT level, attributionKey, scopeKey, COUNT(*) AS rows, MIN(date) AS firstDate, MAX(date) AS lastDate, MAX(observedAt) AS lastObservedAt FROM DailyInsight GROUP BY level, attributionKey, scopeKey ORDER BY level, attributionKey, scopeKey"),
  ]);
  const snapshot = saved[0] ? JSON.parse(String(saved[0].payload)) : null;
  const checkedAt = snapshot?.checkedAt ?? null;
  const end = Date.parse(checkedAt);
  const start = end - 30 * 86400000;
  const entries = snapshot?.entries ?? [];
  const real = entries.filter((entry) => !entry.test);
  const recent = Number.isFinite(end) ? real.filter((entry) => inWindow(entry.contactCreated, start, end)) : [];
  const receipts = Number.isFinite(end) ? real.flatMap((entry) => entry.submissions ?? []).filter((sub) => inWindow(sub.at, start, end)) : [];
  const formOriginWithoutReceipt = Number.isFinite(end) ? real.filter((entry) => entry.formOrigin && inWindow(entry.contactCreated, start, end) && !(entry.submissions ?? []).some((sub) => inWindow(sub.at, start, end))) : [];
  const appointments = Number.isFinite(end) ? real.flatMap((entry) => entry.appointments ?? []).filter((event) => inWindow(event.at, start, end)) : [];
  const result = {
    checkedNow: new Date().toISOString(),
    register: snapshot ? {
      checkedAt,
      ageMinutes: Math.round((Date.now() - end) / 60000),
      coverageStart: snapshot.coverageStart,
      savedContactsAllTime: entries.length,
      taggedTestContactsAllTime: entries.length - real.length,
      nonTestContactsCreatedLast30Days: recent.length,
      configuredFormReceiptsLast30Days: receipts.length,
      formAttributedContactsWithoutRecentReceiptLast30Days: formOriginWithoutReceipt.length,
      salesCalendarEventsLast30Days: appointments.length,
    } : null,
    meta: {
      latestRuns: metaRuns.map((run) => ({ ...run })),
      insightGroups: insights.map((group) => ({ ...group })),
    },
    stageBasedCrm: { configuredEnabled: JSON.parse(fs.readFileSync(`${repo}/wrangler.jsonc`, "utf8")).vars.HIGHLEVEL_SYNC_ENABLED === "true", latestRuns: crmRuns.map((run) => ({ ...run })) },
  };
  console.log(JSON.stringify(result, null, 2));
} finally {
  database.close();
}
