import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient, withDatabaseClient } from "../lib/db.ts";
import { readMonthlyPerformance } from "../lib/monthly-performance-store.ts";
import { GET } from "../app/api/dashboard/monthly/route.ts";
test("monthly storage isolates account/scope/attribution and withholds rows omitted by the latest success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-report-"));
  const db = createPrismaClient({ url: `file:${join(directory, "report.db")}` });
  const keys = ["META_AD_ACCOUNT_ID", "META_CAMPAIGN_ID", "META_ATTRIBUTION_WINDOWS", "META_PRIMARY_RESULT_ACTION_TYPE", "HIGHLEVEL_LOCATION_ID"];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { META_AD_ACCOUNT_ID: "1", META_ATTRIBUTION_WINDOWS: "7d_click,1d_view", META_PRIMARY_RESULT_ACTION_TYPE: "offsite_conversion.fb_pixel_lead" });
  delete process.env.META_CAMPAIGN_ID; delete process.env.HIGHLEVEL_LOCATION_ID;
  try {
    await withDatabaseClient(db, async c => {
      await c.executeMultiple(`
        CREATE TABLE SyncRun(id TEXT, accountId TEXT, attributionKey TEXT, campaignId TEXT, status TEXT, finishedAt TEXT, timezoneName TEXT, currencyCode TEXT, requestedSince TEXT, requestedUntil TEXT);
        CREATE TABLE DailyInsight(date TEXT, level TEXT, entityId TEXT, attributionKey TEXT, scopeKey TEXT, syncRunId TEXT, currencyCode TEXT, spendMinorUnits INT, impressions INT, linkClicks INT, leads INT, resultActionType TEXT, rawActions TEXT);
        CREATE TABLE Campaign(metaId TEXT, name TEXT); CREATE TABLE Ad(metaId TEXT, name TEXT);
        INSERT INTO SyncRun VALUES('history','act_1','7d_click,1d_view',NULL,'SUCCEEDED','2025-12-01T06:00:00Z','Europe/London','GBP','2025-11-01','2025-11-30');
        INSERT INTO DailyInsight VALUES('2025-11-20','account','act_1','7d_click,1d_view','account','history','GBP',1000,100,10,2,'offsite_conversion.fb_pixel_lead','[]');
        INSERT INTO SyncRun VALUES('old','act_1','7d_click,1d_view',NULL,'SUCCEEDED','2026-09-01T06:00:00Z','Europe/London','GBP','2026-08-01','2026-09-01');
        INSERT INTO SyncRun VALUES('new','act_1','7d_click,1d_view',NULL,'SUCCEEDED','2026-09-02T06:00:00Z','Europe/London','GBP','2026-09-02','2026-09-02');
        INSERT INTO SyncRun VALUES('other','act_2','7d_click,1d_view',NULL,'SUCCEEDED','2026-09-02T06:00:00Z','Europe/London','GBP','2026-09-01','2026-09-02');
        INSERT INTO DailyInsight VALUES('2026-09-01','account','act_1','7d_click,1d_view','account','old','GBP',1000,100,10,NULL,'offsite_conversion.fb_pixel_lead','[]');
        INSERT INTO DailyInsight VALUES('2026-09-02','account','act_1','7d_click,1d_view','account','old','GBP',1000,100,10,NULL,'offsite_conversion.fb_pixel_lead','[]');
        INSERT INTO DailyInsight VALUES('2026-09-01','account','act_1','7d_click,1d_view','campaign-x','old','GBP',999999,100,10,999,NULL,'[]');
        INSERT INTO DailyInsight VALUES('2026-09-01','account','act_1','1d_click','account','old','GBP',999999,100,10,999,NULL,'[]');
        INSERT INTO DailyInsight VALUES('2026-09-01','account','act_1','7d_click,1d_view','account','other','GBP',999999,100,10,999,NULL,'[]');
      `);
    });
    const result = await readMonthlyPerformance(new Date("2026-09-02T12:00:00Z"), db);
    assert.equal(result.months[0].days, 2);
    assert.equal(result.months[0].metrics.spend, null, "omitted latest-day receipt is unknown");
    assert.equal(result.months[0].metrics.leads, null, "omitted rows cannot be recovered as zero");
    const later = await readMonthlyPerformance(new Date("2026-12-02T12:00:00Z"), db);
    assert.equal(later.months.at(-1).month, "2025-11", "storage retains the agreed baseline past twelve months");
    assert.equal(later.months.at(-1).metrics.spend, 1000);
    assert.equal(result.metaCheckedAt, "2026-09-02T06:00:00.000Z");
    const beforeOmission = await readMonthlyPerformance(new Date("2026-09-01T12:00:00Z"), db);
    assert.equal(beforeOmission.months[0].metrics.spend, 1000, "other scopes and accounts must not contribute");
    assert.equal(beforeOmission.months[0].metrics.leads, 0, "valid matching old receipt can be replayed without writes");
  } finally {
    for (const key of keys) { if (original[key] == null) delete process.env[key]; else process.env[key] = original[key]; }
    await db.$disconnect(); await rm(directory, { recursive: true, force: true });
  }
});
test("monthly aggregate endpoint requires a private dashboard session before reading storage", async () => {
  const response = await GET(new Request("https://dashboard.invalid/api/dashboard/monthly"));
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "Unauthorized" });
});
