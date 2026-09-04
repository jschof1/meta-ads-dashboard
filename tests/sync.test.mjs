import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { diagnoseResultEvents } from "../lib/meta.ts";
import { buildDashboardState } from "../lib/read-model.ts";
import { SyncAlreadyRunningError, syncMeta } from "../lib/sync.ts";

const migrationPath = new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url);
const databases = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr03-"));
  const path = join(directory, "test.db");
  const db = createPrismaClient({ url: `file:${path}` });
  const migration = await readFile(migrationPath, "utf8");
  const statements = migration
    .split(/;\s*(?:\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await db.$executeRawUnsafe(statement);
  databases.push({ db, directory });
  return db;
}

afterEach(async () => {
  while (databases.length > 0) {
    const current = databases.pop();
    await current.db.$disconnect();
    await rm(current.directory, { recursive: true, force: true });
  }
});

const account = {
  id: "act_uktl-test",
  name: "UK Trade Leads",
  currency: "GBP",
  timezone_name: "Europe/London",
};

const metadata = {
  campaigns: [{ id: "campaign-1", name: "UKTL Leads", objective: "OUTCOME_LEADS", status: "ACTIVE", effective_status: "ACTIVE" }],
  adSets: [{
    id: "adset-1",
    campaign_id: "campaign-1",
    name: "UKTL Prospecting",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    optimization_goal: "LEAD_GENERATION",
    billing_event: "IMPRESSIONS",
    daily_budget: "5000",
    lifetime_budget: "120000",
    learning_stage_info: { status: "LEARNING", samples: 4 },
  }],
  ads: [{
    id: "ad-1",
    name: "Trade lead creative",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    campaign_id: "campaign-1",
    adset_id: "adset-1",
    creative_id: "creative-1",
  }],
  creatives: [{
    id: "creative-1",
    name: "Trade lead creative",
    title: "Get more trade leads",
    body: "Book a discovery call",
    call_to_action_type: "LEARN_MORE",
    thumbnail_url: "https://example.test/thumb.jpg",
    image_hash: "hash-1",
    object_url: "https://example.test/book",
  }],
};

function insight(date, overrides = {}) {
  return {
    account_id: account.id,
    account_name: account.name,
    campaign_id: "campaign-1",
    campaign_name: "UKTL Leads",
    adset_id: "adset-1",
    adset_name: "UKTL Prospecting",
    ad_id: "ad-1",
    ad_name: "Trade lead creative",
    spend: "12.34",
    impressions: "1000",
    reach: "500",
    clicks: "100",
    inline_link_clicks: "80",
    date_start: date,
    date_stop: date,
    actions: [{ action_type: "offsite_conversion.custom.lead", value: "2" }],
    ...overrides,
  };
}

function fakeClient(options = {}) {
  const calls = [];
  const rows = options.rows ?? {
    account: [insight("2026-09-04")],
    campaign: [insight("2026-09-04")],
    adset: [insight("2026-09-04")],
    ad: [insight("2026-09-04")],
  };
  const diagnosticOptions = options.diagnosticOptions ?? { primaryActionType: "offsite_conversion.custom.lead" };
  const diagnostics = options.diagnostics ?? {
    attempts: 1,
    traceId: "trace-pr03-test",
    appUsage: { call_count: 4 },
    adAccountUsage: { acc_id_util_pct: 2 },
  };
  const client = {
    getAccountId: () => account.id,
    getGraphVersion: () => "v25.0",
    getAttributionKey: () => "7d_click,1d_view",
    getDiagnostics: () => diagnostics,
    diagnoseResultEvents: (row) => diagnoseResultEvents(row, diagnosticOptions),
    getAccount: async () => {
      if (options.getAccount) return options.getAccount();
      return account;
    },
    listCampaigns: async () => metadata.campaigns,
    listAdSets: async () => metadata.adSets,
    listAds: async () => metadata.ads,
    listCreatives: async () => metadata.creatives,
    getDailyInsights: async (level, range) => {
      calls.push({ level, range });
      if (options.getDailyInsights) return options.getDailyInsights(level, range);
      return typeof rows[level] === "function" ? rows[level]() : rows[level] ?? [];
    },
  };
  return { client, calls, rows };
}

async function run(db, client, now = new Date("2026-09-04T12:00:00.000Z"), options = {}) {
  return syncMeta({ db, client, now, clock: () => now, initialBackfillDays: 90, recentRefreshDays: 7, ...options });
}

test("performs the 90-day first sync, persists metadata/insights, and keeps real zeroes distinct from missing values", async () => {
  const db = await createDatabase();
  const { client, calls } = fakeClient({ rows: {
    account: [insight("2026-09-04", { spend: "0", impressions: "0", reach: "0", clicks: "0", inline_link_clicks: "0", actions: [] })],
    campaign: [insight("2026-09-04", { actions: [] })],
    adset: [insight("2026-09-04", { actions: [] })],
    ad: [insight("2026-09-04", { actions: [] })],
  } });

  const result = await run(db, client);

  assert.equal(result.initialBackfill, true);
  assert.equal(result.since, "2026-06-07");
  assert.equal(result.until, "2026-09-04");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => call.range), [
    { since: "2026-06-07", until: "2026-09-04" },
    { since: "2026-06-07", until: "2026-09-04" },
    { since: "2026-06-07", until: "2026-09-04" },
    { since: "2026-06-07", until: "2026-09-04" },
  ]);

  assert.equal(await db.campaign.count(), 1);
  assert.equal(await db.adSet.findUnique({ where: { metaId: "adset-1" } }).then((row) => row.dailyBudgetMinor), 5000);
  assert.equal(await db.adSet.findUnique({ where: { metaId: "adset-1" } }).then((row) => row.lifetimeBudgetMinor), 120000);
  assert.equal(await db.dailyInsight.count(), 4);
  const accountRow = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view" } },
  });
  assert.equal(accountRow.spendMinorUnits, 0);
  assert.equal(accountRow.impressions, 0);
  assert.equal(accountRow.leads, null);

  const runRow = await db.syncRun.findUnique({ where: { id: result.runId } });
  assert.equal(runRow.status, "SUCCEEDED");
  assert.equal(runRow.currencyCode, "GBP");
  assert.equal(runRow.timezoneName, "Europe/London");
  assert.equal(runRow.initialBackfill, true);
  assert.equal(runRow.traceId, "trace-pr03-test");
  assert.deepEqual(JSON.parse(runRow.apiDiagnostics), { attempts: 1, traceId: "trace-pr03-test", appUsage: { call_count: 4 }, adAccountUsage: { acc_id_util_pct: 2 } });
  assert.match(runRow.warning, /leads remain missing, not zero/);
});

test("is idempotent and overwrites delayed conversion updates during the recent refresh window", async () => {
  const db = await createDatabase();
  const { client, rows, calls } = fakeClient();
  const first = await run(db, client, new Date("2026-09-04T12:00:00.000Z"));
  rows.account[0] = insight("2026-09-04", { spend: "20.00", actions: [{ action_type: "offsite_conversion.custom.lead", value: "4" }] });
  rows.campaign[0] = rows.account[0];
  rows.adset[0] = rows.account[0];
  rows.ad[0] = rows.account[0];
  const second = await run(db, client, new Date("2026-09-05T12:00:00.000Z"));

  assert.equal(first.initialBackfill, true);
  assert.equal(second.initialBackfill, false);
  assert.equal(second.since, "2026-08-30");
  assert.equal(second.until, "2026-09-05");
  assert.equal(calls[4].range.since, "2026-08-30");
  assert.equal(await db.dailyInsight.count(), 4);
  const row = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view" } },
  });
  assert.equal(row.spendMinorUnits, 2000);
  assert.equal(row.leads, 4);
  assert.equal(row.cplMinorUnits, 500);
  assert.equal(await db.syncRun.count({ where: { status: "SUCCEEDED" } }), 2);
});

test("prevents overlapping runs with an account-scoped lease", async () => {
  const db = await createDatabase();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let firstAccountCall = true;
  const { client } = fakeClient({
    getAccount: async () => {
      if (firstAccountCall) {
        firstAccountCall = false;
        await held;
      }
      return account;
    },
  });

  const first = run(db, client);
  while (await db.syncRun.count() === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(() => run(db, client), SyncAlreadyRunningError);
  release();
  await first;
  assert.equal(await db.syncRun.count(), 1);
});

test("marks a failed refresh without discarding the last successful read model", async () => {
  const db = await createDatabase();
  const { client } = fakeClient();
  await run(db, client, new Date("2026-09-04T12:00:00.000Z"));
  const failing = fakeClient({
    getDailyInsights: async (level) => {
      if (level === "campaign") throw new Error("provider unavailable");
      return [insight("2026-09-05")];
    },
  });
  await assert.rejects(() => run(db, failing.client, new Date("2026-09-05T12:00:00.000Z")), /provider unavailable/);

  const stored = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view" } },
  });
  const latest = await db.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  const state = await buildDashboardState({ db, now: new Date("2026-09-05T12:00:00.000Z") });

  assert.equal(stored.leads, 2);
  assert.equal(latest.status, "FAILED");
  assert.match(latest.error, /provider unavailable/);
  assert.equal(latest.traceId, "trace-pr03-test");
  assert.equal(state.meta.syncState, "failed");
  assert.equal(state.meta.lastAttemptStatus, "FAILED");
  assert.equal(state.scorecard.last30.registrations, 2);
});

test("loads dashboard state from stored data with no Meta client and reports stale data honestly", async () => {
  const db = await createDatabase();
  const { client } = fakeClient();
  await run(db, client, new Date("2026-09-04T12:00:00.000Z"));

  const fresh = await buildDashboardState({ db, now: new Date("2026-09-04T12:30:00.000Z") });
  const stale = await buildDashboardState({ db, now: new Date("2026-09-06T15:00:00.000Z") });

  assert.equal(fresh.meta.syncState, "fresh");
  assert.equal(fresh.meta.currencyCode, "GBP");
  assert.equal(fresh.scorecard.last7.spendCents, 1234);
  assert.equal(fresh.scorecard.last7.registrations, 2);
  assert.equal(fresh.funnel.attended, null);
  assert.equal(fresh.funnel.crmConfigured, false);
  assert.equal(stale.meta.syncState, "stale");
  assert.equal(stale.meta.lastSuccessfulSyncAt, "2026-09-04T12:00:00.000Z");
});

test("handles an empty account without manufacturing zero performance", async () => {
  const db = await createDatabase();
  const { client } = fakeClient({ rows: { account: [], campaign: [], adset: [], ad: [] } });
  const result = await run(db, client);
  const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:00:00.000Z") });

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.rowsFetched, 4);
  assert.equal(result.rowsWritten, 4);
  assert.equal(state.meta.syncState, "fresh");
  assert.equal(state.scorecard.today.spendCents, null);
  assert.equal(state.scorecard.today.impressions, null);
  assert.equal(state.scorecard.today.registrations, null);
  assert.equal(state.scorecard.today.cprCents, null);
  assert.equal(state.trend.length, 30);
  assert.equal(state.trend.at(-1).spendCents, null);
});
