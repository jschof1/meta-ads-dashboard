import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { diagnoseResultEvents } from "../lib/meta.ts";
import { buildDashboardState } from "../lib/read-model.ts";
import { SyncAlreadyRunningError, syncMeta } from "../lib/sync.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
];
const databases = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr03-"));
  const path = join(directory, "test.db");
  const db = createPrismaClient({ url: `file:${path}` });
  for (const migrationPath of migrationPaths) {
    const migration = await readFile(migrationPath, "utf8");
    const statements = migration
      .split(/;\s*(?:\n|$)/g)
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  }
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
  campaigns: [{ id: "campaign-1", name: "UKTL Leads", objective: "OUTCOME_LEADS", status: "ACTIVE", effective_status: "ACTIVE", daily_budget: "10000", lifetime_budget: "250000", updated_time: "2026-09-04T10:00:00+0000" }],
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
    updated_time: "2026-09-04T10:01:00+0000",
  }],
  ads: [{
    id: "ad-1",
    name: "Trade lead creative",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    campaign_id: "campaign-1",
    adset_id: "adset-1",
    creative_id: "creative-1",
    updated_time: "2026-09-04T10:02:00+0000",
  }],
  creatives: [{
    id: "creative-1",
    name: "Trade lead creative",
    title: "Get more trade leads",
    body: "Book a discovery call",
    call_to_action_type: "LEARN_MORE",
    thumbnail_url: "https://example.test/thumb.jpg",
    image_hash: "hash-1",
    image_url: null,
    video_id: null,
    object_id: null,
    link_url: null,
    object_url: "https://example.test/book",
    asset_feed_spec: null,
    url_tags: null,
    updated_time: "2026-09-04T10:03:00+0000",
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
  const configuredMetadata = options.metadata ?? metadata;
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
  const attributionKey = options.attributionKey ?? "7d_click,1d_view";
  const client = {
    getAccountId: () => account.id,
    getGraphVersion: () => "v25.0",
    getAttributionKey: () => attributionKey,
    getDiagnostics: () => diagnostics,
    diagnoseResultEvents: (row) => diagnoseResultEvents(row, diagnosticOptions),
    getAccount: async () => {
      if (options.getAccount) return options.getAccount();
      return account;
    },
    listCampaigns: async () => configuredMetadata.campaigns,
    listAdSets: async () => configuredMetadata.adSets,
    listAds: async () => configuredMetadata.ads,
    listCreatives: async () => configuredMetadata.creatives,
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
    account: [insight("2026-09-04", { account_id: "uktl-test", spend: "0", impressions: "0", reach: "0", clicks: "0", inline_link_clicks: "0", actions: [] })],
    campaign: [insight("2026-09-04", { actions: [] })],
    adset: [insight("2026-09-04", { actions: [] })],
    ad: [insight("2026-09-04", { actions: [] })],
  } });

  const result = await run(db, client);

  assert.equal(result.initialBackfill, true);
  assert.equal(await db.syncRun.findUnique({ where: { id: result.runId } }).then((row) => row.campaignId), null);
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
  assert.equal(await db.campaign.findUnique({ where: { metaId: "campaign-1" } }).then((row) => row.dailyBudgetMinor), 10000);
  assert.equal(await db.campaign.findUnique({ where: { metaId: "campaign-1" } }).then((row) => row.lifetimeBudgetMinor), 250000);
  assert.equal(await db.adSet.findUnique({ where: { metaId: "adset-1" } }).then((row) => row.dailyBudgetMinor), 5000);
  assert.equal(await db.adSet.findUnique({ where: { metaId: "adset-1" } }).then((row) => row.lifetimeBudgetMinor), 120000);
  assert.equal((await db.campaign.findUnique({ where: { metaId: "campaign-1" } })).providerUpdatedAt.toISOString(), "2026-09-04T10:00:00.000Z");
  assert.equal((await db.campaign.findUnique({ where: { metaId: "campaign-1" } })).lastSeenSyncRunId, result.runId);
  assert.equal((await db.adSet.findUnique({ where: { metaId: "adset-1" } })).providerUpdatedAt.toISOString(), "2026-09-04T10:01:00.000Z");
  assert.equal((await db.adSet.findUnique({ where: { metaId: "adset-1" } })).lastSeenSyncRunId, result.runId);
  assert.equal((await db.ad.findUnique({ where: { metaId: "ad-1" } })).providerUpdatedAt.toISOString(), "2026-09-04T10:02:00.000Z");
  assert.equal((await db.ad.findUnique({ where: { metaId: "ad-1" } })).lastSeenSyncRunId, result.runId);
  assert.equal((await db.creative.findUnique({ where: { metaId: "creative-1" } })).providerUpdatedAt.toISOString(), "2026-09-04T10:03:00.000Z");
  assert.equal((await db.creative.findUnique({ where: { metaId: "creative-1" } })).lastSeenSyncRunId, result.runId);
  assert.equal(await db.dailyInsight.count(), 4);
  const accountRow = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(accountRow.spendMinorUnits, 0);
  assert.equal(accountRow.impressions, 0);
  assert.equal(accountRow.leads, null);

  const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:00:00.000Z") });
  assert.equal(state.ads[0].verdict, "too_early");
  assert.match(state.ads[0].verdictReason, /need 3\+ stored leads/);
  assert.equal(state.ads[0].lastChangeAt, "2026-09-04T10:03:00.000Z");
  assert.equal(state.ads[0].format, "image");
  assert.equal(state.campaigns[0].status, "ACTIVE");
  assert.equal(state.adSets[0].status, "ACTIVE");
  assert.equal(state.adSets[0].learningStage, "LEARNING");
  assert.equal(state.ads[0].isCurrent, true);

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
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(row.spendMinorUnits, 2000);
  assert.equal(row.leads, 4);
  assert.equal(row.cplMinorUnits, 500);
  assert.equal(await db.syncRun.count({ where: { status: "SUCCEEDED" } }), 2);
});

test("starts a fresh backfill when the attribution configuration changes", async () => {
  const db = await createDatabase();
  await run(db, fakeClient({ attributionKey: "7d_click,1d_view" }).client, new Date("2026-09-04T12:00:00.000Z"));
  const changed = fakeClient({ attributionKey: "1d_click,1d_view" });
  const result = await run(db, changed.client, new Date("2026-09-05T12:00:00.000Z"));

  assert.equal(result.initialBackfill, true);
  assert.equal(result.since, "2026-06-08");
  assert.equal(result.until, "2026-09-05");
  assert.equal(await db.syncRun.count({ where: { status: "SUCCEEDED" } }), 2);
  assert.equal(await db.dailyInsight.count(), 8);
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

test("reclaims an expired lease and records the abandoned run as failed", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  await db.syncRun.create({
    data: {
      accountId: account.id,
      trigger: "cron",
      status: "RUNNING",
      attributionKey: "7d_click,1d_view",
      startedAt: new Date("2026-09-04T11:00:00.000Z"),
      lockKey: account.id,
      lockOwner: "abandoned-run",
      lockExpiresAt: new Date("2026-09-04T11:30:00.000Z"),
    },
  });

  const result = await run(db, fakeClient().client, now);
  const runs = await db.syncRun.findMany({ orderBy: { startedAt: "asc" } });

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(runs[0].status, "FAILED");
  assert.match(runs[0].error, /lease expired/);
  assert.equal(runs[0].lockKey, null);
  assert.equal(runs[1].status, "SUCCEEDED");
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
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  const latest = await db.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  const state = await buildDashboardState({ db, now: new Date("2026-09-05T12:00:00.000Z") });

  assert.equal(stored.leads, 2);
  assert.equal(latest.status, "FAILED");
  assert.match(latest.error, /provider unavailable/);
  assert.equal(latest.traceId, "trace-pr03-test");
  assert.equal(state.meta.syncState, "failed");
  assert.equal(state.meta.lastAttemptStatus, "FAILED");
  assert.equal(state.meta.lastSyncError.includes("provider unavailable"), false);
  assert.match(state.meta.lastSyncError, /redacted provider diagnostic/);
  assert.equal(state.scorecard.last30.leads, 2);
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
  assert.equal(fresh.scorecard.last7.leads, 2);
  assert.equal(fresh.funnel.callsAttended, null);
  assert.equal(fresh.funnel.crmConfigured, false);
  assert.equal(stale.meta.syncState, "stale");
  assert.equal(stale.meta.lastSuccessfulSyncAt, "2026-09-04T12:00:00.000Z");
});

test("scopes the dashboard read model to the active account's successful sync history", async () => {
  const db = await createDatabase();
  const previousAccountId = process.env.META_AD_ACCOUNT_ID;
  process.env.META_AD_ACCOUNT_ID = "act_current";
  try {
    await db.syncRun.create({
      data: {
        id: "run-old-account",
        accountId: "act_old",
        currencyCode: "USD",
        timezoneName: "America/New_York",
        trigger: "manual",
        status: "SUCCEEDED",
        attributionKey: "7d_click,1d_view",
        startedAt: new Date("2026-09-03T12:00:00.000Z"),
        finishedAt: new Date("2026-09-03T12:01:00.000Z"),
      },
    });
    await db.syncRun.create({
      data: {
        id: "run-current-account",
        accountId: "act_current",
        currencyCode: "GBP",
        timezoneName: "Europe/London",
        trigger: "manual",
        status: "SUCCEEDED",
        attributionKey: "7d_click,1d_view",
        startedAt: new Date("2026-09-04T12:00:00.000Z"),
        finishedAt: new Date("2026-09-04T12:01:00.000Z"),
      },
    });
    await db.ad.createMany({
      data: [
        { metaId: "ad-old", name: "Old account ad" },
        { metaId: "ad-current", name: "Current account ad" },
      ],
    });
    await db.dailyInsight.createMany({
      data: [
        { date: "2026-09-04", level: "account", entityId: "act_old", attributionKey: "7d_click,1d_view", currencyCode: "USD", spendMinorUnits: 9900, impressions: 1000, leads: 9, syncRunId: "run-old-account" },
        { date: "2026-09-04", level: "ad", entityId: "ad-old", attributionKey: "7d_click,1d_view", currencyCode: "USD", spendMinorUnits: 9900, impressions: 1000, leads: 9, syncRunId: "run-old-account" },
        { date: "2026-09-04", level: "account", entityId: "act_current", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 900, impressions: 100, leads: 1, syncRunId: "run-current-account" },
        { date: "2026-09-04", level: "ad", entityId: "ad-current", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 900, impressions: 100, leads: 1, syncRunId: "run-current-account" },
      ],
    });

    const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:30:00.000Z") });
    assert.equal(state.meta.adAccountId, "act_current");
    assert.equal(state.meta.currencyCode, "GBP");
    assert.equal(state.scorecard.today.spendCents, 900);
    assert.deepEqual(state.ads.map((ad) => ad.adId), ["ad-current"]);
  } finally {
    if (previousAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = previousAccountId;
  }
});

test("keeps campaign-scoped dashboard reads separate from account-wide sync history", async () => {
  const db = await createDatabase();
  const previousAccountId = process.env.META_AD_ACCOUNT_ID;
  const previousCampaignId = process.env.META_CAMPAIGN_ID;
  process.env.META_AD_ACCOUNT_ID = "act_scope";
  process.env.META_CAMPAIGN_ID = "campaign-selected";
  try {
    await db.syncRun.createMany({
      data: [
        {
          id: "run-account-wide",
          accountId: "act_scope",
          campaignId: null,
          currencyCode: "GBP",
          timezoneName: "Europe/London",
          trigger: "manual",
          status: "SUCCEEDED",
          attributionKey: "7d_click,1d_view",
          startedAt: new Date("2026-09-03T12:00:00.000Z"),
          finishedAt: new Date("2026-09-03T12:01:00.000Z"),
        },
        {
          id: "run-campaign-scoped",
          accountId: "act_scope",
          campaignId: "campaign-selected",
          currencyCode: "GBP",
          timezoneName: "Europe/London",
          trigger: "manual",
          status: "SUCCEEDED",
          attributionKey: "7d_click,1d_view",
          startedAt: new Date("2026-09-04T12:00:00.000Z"),
          finishedAt: new Date("2026-09-04T12:01:00.000Z"),
        },
      ],
    });
    await db.dailyInsight.createMany({
      data: [
        { date: "2026-09-03", level: "account", entityId: "act_scope", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 9900, impressions: 1000, leads: 9, syncRunId: "run-account-wide" },
        { date: "2026-09-03", level: "campaign", entityId: "campaign-other", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 9900, impressions: 1000, leads: 9, syncRunId: "run-account-wide" },
        { date: "2026-09-04", level: "account", entityId: "act_scope", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 900, impressions: 100, leads: 1, syncRunId: "run-campaign-scoped" },
        { date: "2026-09-04", level: "campaign", entityId: "campaign-selected", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 900, impressions: 100, leads: 1, syncRunId: "run-campaign-scoped" },
      ],
    });

    const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:30:00.000Z") });

    assert.equal(state.meta.campaignId, "campaign-selected");
    assert.equal(state.meta.adAccountId, "act_scope");
    assert.equal(state.scorecard.today.spendCents, 900);
    assert.equal(state.scorecard.today.leads, 1);
    assert.deepEqual(state.campaigns.map((campaign) => campaign.campaignId), ["campaign-selected"]);
  } finally {
    if (previousAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = previousAccountId;
    if (previousCampaignId === undefined) delete process.env.META_CAMPAIGN_ID;
    else process.env.META_CAMPAIGN_ID = previousCampaignId;
  }
});

test("keeps independent campaign-scoped histories isolated across campaigns and failed attempts", async () => {
  const db = await createDatabase();
  const previousAccountId = process.env.META_AD_ACCOUNT_ID;
  const previousCampaignId = process.env.META_CAMPAIGN_ID;
  process.env.META_AD_ACCOUNT_ID = "act_scope-history";
  try {
    await db.syncRun.createMany({
      data: [
        {
          id: "run-scope-a",
          accountId: "act_scope-history",
          campaignId: "campaign-a",
          currencyCode: "GBP",
          timezoneName: "Europe/London",
          trigger: "manual",
          status: "SUCCEEDED",
          attributionKey: "7d_click,1d_view",
          startedAt: new Date("2026-09-04T08:00:00.000Z"),
          finishedAt: new Date("2026-09-04T08:01:00.000Z"),
        },
        {
          id: "run-scope-b",
          accountId: "act_scope-history",
          campaignId: "campaign-b",
          currencyCode: "GBP",
          timezoneName: "Europe/London",
          trigger: "manual",
          status: "SUCCEEDED",
          attributionKey: "7d_click,1d_view",
          startedAt: new Date("2026-09-04T09:00:00.000Z"),
          finishedAt: new Date("2026-09-04T09:01:00.000Z"),
        },
        {
          id: "run-scope-b-failed",
          accountId: "act_scope-history",
          campaignId: "campaign-b",
          currencyCode: "GBP",
          timezoneName: "Europe/London",
          trigger: "cron",
          status: "FAILED",
          attributionKey: "7d_click,1d_view",
          startedAt: new Date("2026-09-04T10:00:00.000Z"),
          finishedAt: new Date("2026-09-04T10:01:00.000Z"),
          error: "redacted provider diagnostic",
        },
      ],
    });
    await db.dailyInsight.createMany({
      data: [
        { date: "2026-09-04", level: "account", entityId: "act_scope-history", scopeKey: "campaign-a", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 100, impressions: 100, leads: 1, syncRunId: "run-scope-a" },
        { date: "2026-09-04", level: "campaign", entityId: "campaign-a", scopeKey: "campaign-a", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 100, impressions: 100, leads: 1, syncRunId: "run-scope-a" },
        { date: "2026-09-04", level: "account", entityId: "act_scope-history", scopeKey: "campaign-b", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 200, impressions: 200, leads: 2, syncRunId: "run-scope-b" },
        { date: "2026-09-04", level: "campaign", entityId: "campaign-b", scopeKey: "campaign-b", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 200, impressions: 200, leads: 2, syncRunId: "run-scope-b" },
      ],
    });

    process.env.META_CAMPAIGN_ID = "campaign-a";
    const campaignA = await buildDashboardState({ db, now: new Date("2026-09-04T12:00:00.000Z") });
    assert.equal(campaignA.scorecard.today.spendCents, 100);
    assert.deepEqual(campaignA.campaigns.map((campaign) => campaign.campaignId), ["campaign-a"]);
    assert.equal(campaignA.meta.syncState, "fresh");

    process.env.META_CAMPAIGN_ID = "campaign-b";
    const campaignB = await buildDashboardState({ db, now: new Date("2026-09-04T12:00:00.000Z") });
    assert.equal(campaignB.scorecard.today.spendCents, 200);
    assert.deepEqual(campaignB.campaigns.map((campaign) => campaign.campaignId), ["campaign-b"]);
    assert.equal(campaignB.meta.syncState, "failed");
    assert.equal(campaignB.dataWarnings.today.some((warning) => warning.id === "sync-failed"), true);
  } finally {
    if (previousAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = previousAccountId;
    if (previousCampaignId === undefined) delete process.env.META_CAMPAIGN_ID;
    else process.env.META_CAMPAIGN_ID = previousCampaignId;
  }
});

test("deduplicates repeated provider rows and accepts a delayed null-to-known result", async () => {
  const db = await createDatabase();
  const duplicate = insight("2026-09-04", { spend: "10.00", actions: [] });
  const { client, rows } = fakeClient({ rows: {
    account: [duplicate, { ...duplicate, spend: "11.00" }],
    campaign: [duplicate],
    adset: [duplicate],
    ad: [duplicate],
  } });

  await run(db, client);
  let stored = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(await db.dailyInsight.count(), 4);
  assert.equal(stored.spendMinorUnits, 1100);
  assert.equal(stored.leads, null);

  rows.account[0] = insight("2026-09-04", { spend: "11.00", actions: [{ action_type: "offsite_conversion.custom.lead", value: "3" }] });
  rows.account[1] = rows.account[0];
  rows.campaign[0] = rows.account[0];
  rows.adset[0] = rows.account[0];
  rows.ad[0] = rows.account[0];
  await run(db, client, new Date("2026-09-05T12:00:00.000Z"));
  stored = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(stored.leads, 3);
  assert.equal(stored.cplMinorUnits, 367);
});

test("rolls back metadata and insights together when the durable transaction fails", async () => {
  const db = await createDatabase();
  await db.$executeRawUnsafe(`CREATE TRIGGER force_daily_insight_failure BEFORE INSERT ON "DailyInsight" BEGIN SELECT RAISE(ABORT, 'forced transaction failure'); END`);

  // libsql currently maps SQLite RAISE(ABORT, ...) through its generic
  // foreign-key error surface; either message still proves the transaction
  // aborted before any metadata was committed.
  await assert.rejects(() => run(db, fakeClient().client), /forced transaction failure|Foreign key constraint/);
  assert.equal(await db.campaign.count(), 0);
  assert.equal(await db.adSet.count(), 0);
  assert.equal(await db.ad.count(), 0);
  assert.equal(await db.creative.count(), 0);
  assert.equal(await db.dailyInsight.count(), 0);
  const failed = await db.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.lockKey, null);
  assert.equal(failed.lockOwner, null);
});

test("fences a run when its lease is invalidated before commit", async () => {
  const db = await createDatabase();
  const { client } = fakeClient({
    getDailyInsights: async (level) => {
      if (level === "ad") {
        await db.syncRun.updateMany({
          where: { status: "RUNNING" },
          data: { lockExpiresAt: new Date("1970-01-01T00:00:00.000Z") },
        });
      }
      return [insight("2026-09-04")];
    },
  });

  await assert.rejects(() => run(db, client), /lease was lost/);
  assert.equal(await db.campaign.count(), 0);
  assert.equal(await db.dailyInsight.count(), 0);
  const failed = await db.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.lockKey, null);
  assert.equal(failed.lockOwner, null);
});

test("keeps existing read-model rows intact when an update transaction fails", async () => {
  const db = await createDatabase();
  await run(db, fakeClient().client, new Date("2026-09-04T12:00:00.000Z"));
  await db.$executeRawUnsafe(`CREATE TRIGGER force_campaign_update_failure BEFORE UPDATE ON "Campaign" BEGIN SELECT RAISE(ABORT, 'forced campaign update failure'); END`);

  await assert.rejects(() => run(db, fakeClient().client, new Date("2026-09-05T12:00:00.000Z")), /forced campaign update failure|Foreign key constraint/);
  const campaign = await db.campaign.findUnique({ where: { metaId: "campaign-1" } });
  const stored = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(campaign.name, "UKTL Leads");
  assert.equal(stored.spendMinorUnits, 1234);
  assert.equal(stored.leads, 2);
  assert.equal(await db.syncRun.count({ where: { status: "SUCCEEDED" } }), 1);
});

test("uses an account-local DST boundary when choosing the sync range", async () => {
  const db = await createDatabase();
  const transition = new Date("2026-03-29T23:30:00.000Z");
  const { client, calls } = fakeClient({ rows: {
    account: [insight("2026-03-30")],
    campaign: [insight("2026-03-30")],
    adset: [insight("2026-03-30")],
    ad: [insight("2026-03-30")],
  } });

  const result = await run(db, client, transition);
  assert.equal(result.until, "2026-03-30");
  assert.equal(calls[0].range.until, "2026-03-30");
  assert.equal(await db.dailyInsight.count(), 4);
});

test("uses UTC and records a warning when Meta supplies an invalid account timezone", async () => {
  const db = await createDatabase();
  const { client } = fakeClient({ getAccount: async () => ({ ...account, timezone_name: "Mars/Olympus" }) });
  const result = await run(db, client);
  const stored = await db.syncRun.findUnique({ where: { id: result.runId } });

  assert.equal(stored.timezoneName, "UTC");
  assert.match(stored.warning, /invalid account timezone/);
});

test("handles an empty account without manufacturing zero performance", async () => {
  const db = await createDatabase();
  const { client } = fakeClient({
    metadata: { campaigns: [], adSets: [], ads: [], creatives: [] },
    rows: { account: [], campaign: [], adset: [], ad: [] },
  });
  const result = await run(db, client);
  const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:00:00.000Z") });

  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.rowsFetched, 0);
  assert.equal(result.rowsWritten, 0);
  assert.equal(state.meta.syncState, "fresh");
  assert.equal(state.scorecard.today.spendCents, null);
  assert.equal(state.scorecard.today.impressions, null);
  assert.equal(state.scorecard.today.leads, null);
  assert.equal(state.scorecard.today.cplCents, null);
  assert.equal(state.trend.length, 30);
  assert.equal(state.trend.at(-1).spendCents, null);
});

test("preserves known metadata but clears omitted metrics after a partial provider response", async () => {
  const db = await createDatabase();
  const source = {
    campaigns: [...metadata.campaigns],
    adSets: [...metadata.adSets],
    ads: [...metadata.ads],
    creatives: [...metadata.creatives],
  };
  const { client, rows } = fakeClient({ metadata: source });
  const first = await run(db, client, new Date("2026-09-04T12:00:00.000Z"));

  source.campaigns[0] = { id: "campaign-1" };
  source.adSets[0] = { id: "adset-1" };
  source.ads[0] = { id: "ad-1" };
  source.creatives[0] = { id: "creative-1" };
  const partial = insight("2026-09-04", {
    spend: undefined,
    impressions: undefined,
    reach: undefined,
    clicks: undefined,
    inline_link_clicks: undefined,
    actions: undefined,
  });
  rows.account[0] = partial;
  rows.campaign[0] = partial;
  rows.adset[0] = partial;
  rows.ad[0] = partial;
  await run(db, client, new Date("2026-09-05T12:00:00.000Z"));

  assert.equal((await db.campaign.findUnique({ where: { metaId: "campaign-1" } })).name, "UKTL Leads");
  assert.equal((await db.adSet.findUnique({ where: { metaId: "adset-1" } })).dailyBudgetMinor, 5000);
  assert.equal((await db.ad.findUnique({ where: { metaId: "ad-1" } })).name, "Trade lead creative");
  assert.equal((await db.creative.findUnique({ where: { metaId: "creative-1" } })).title, "Get more trade leads");
  assert.equal((await db.campaign.findUnique({ where: { metaId: "campaign-1" } })).lastSeenSyncRunId, first.runId);
  assert.equal((await db.adSet.findUnique({ where: { metaId: "adset-1" } })).lastSeenSyncRunId, first.runId);
  assert.equal((await db.ad.findUnique({ where: { metaId: "ad-1" } })).lastSeenSyncRunId, first.runId);
  assert.equal((await db.creative.findUnique({ where: { metaId: "creative-1" } })).lastSeenSyncRunId, first.runId);
  const stored = await db.dailyInsight.findUnique({
    where: { date_level_entityId_attributionKey_scopeKey: { date: "2026-09-04", level: "account", entityId: account.id, attributionKey: "7d_click,1d_view", scopeKey: "account" } },
  });
  assert.equal(stored.spendMinorUnits, null);
  assert.equal(stored.impressions, null);
  assert.equal(stored.leads, null);
  assert.equal(stored.cplMinorUnits, null);
  assert.equal(stored.rawActions, "null");
  assert.equal(stored.raw.includes("12.34"), false);
});

test("clears explicitly null provider metadata while preserving fields omitted from a partial response", async () => {
  const db = await createDatabase();
  const source = {
    campaigns: [...metadata.campaigns],
    adSets: [...metadata.adSets],
    ads: [...metadata.ads],
    creatives: [...metadata.creatives],
  };
  const { client, rows } = fakeClient({ metadata: source });
  await run(db, client, new Date("2026-09-04T12:00:00.000Z"));

  source.campaigns[0] = {
    ...metadata.campaigns[0],
    objective: null,
    status: null,
    effective_status: null,
    daily_budget: null,
    lifetime_budget: null,
    updated_time: null,
  };
  source.adSets[0] = {
    ...metadata.adSets[0],
    status: null,
    effective_status: null,
    daily_budget: null,
    lifetime_budget: null,
    learning_stage_info: null,
    updated_time: null,
  };
  source.ads[0] = { ...metadata.ads[0], status: null, effective_status: null, updated_time: null };
  source.creatives[0] = { ...metadata.creatives[0], title: null, object_url: null, updated_time: null };
  const unchangedMetrics = insight("2026-09-04");
  rows.account[0] = unchangedMetrics;
  rows.campaign[0] = unchangedMetrics;
  rows.adset[0] = unchangedMetrics;
  rows.ad[0] = unchangedMetrics;
  await run(db, client, new Date("2026-09-05T12:00:00.000Z"));

  const campaign = await db.campaign.findUnique({ where: { metaId: "campaign-1" } });
  const adSet = await db.adSet.findUnique({ where: { metaId: "adset-1" } });
  const ad = await db.ad.findUnique({ where: { metaId: "ad-1" } });
  const creative = await db.creative.findUnique({ where: { metaId: "creative-1" } });
  assert.equal(campaign.objective, null);
  assert.equal(campaign.configuredStatus, null);
  assert.equal(campaign.effectiveStatus, null);
  assert.equal(campaign.dailyBudgetMinor, null);
  assert.equal(campaign.lifetimeBudgetMinor, null);
  assert.equal(campaign.providerUpdatedAt, null);
  assert.equal(adSet.configuredStatus, null);
  assert.equal(adSet.effectiveStatus, null);
  assert.equal(adSet.dailyBudgetMinor, null);
  assert.equal(adSet.lifetimeBudgetMinor, null);
  assert.equal(adSet.learningStage, null);
  assert.equal(adSet.providerUpdatedAt, null);
  assert.equal(ad.configuredStatus, null);
  assert.equal(ad.effectiveStatus, null);
  assert.equal(ad.providerUpdatedAt, null);
  assert.equal(creative.title, null);
  assert.equal(creative.destinationUrl, null);
  assert.equal(creative.providerUpdatedAt, null);
});

test("scopes discovered metadata and insight rows to META_CAMPAIGN_ID", async () => {
  const db = await createDatabase();
  const previousCampaignId = process.env.META_CAMPAIGN_ID;
  process.env.META_CAMPAIGN_ID = "campaign-1";
  try {
    const inScope = insight("2026-09-04");
    const outOfScope = insight("2026-09-04", {
      campaign_id: "campaign-2",
      campaign_name: "Unrelated campaign",
      adset_id: "adset-2",
      adset_name: "Unrelated ad set",
      ad_id: "ad-2",
      ad_name: "Unrelated ad",
    });
    const { client } = fakeClient({
      metadata: {
        campaigns: [...metadata.campaigns, { ...metadata.campaigns[0], id: "campaign-2", name: "Unrelated campaign" }],
        adSets: [...metadata.adSets, { ...metadata.adSets[0], id: "adset-2", campaign_id: "campaign-2", name: "Unrelated ad set" }],
        ads: [...metadata.ads, { ...metadata.ads[0], id: "ad-2", campaign_id: "campaign-2", adset_id: "adset-2", creative_id: "creative-2" }],
        creatives: [...metadata.creatives, { ...metadata.creatives[0], id: "creative-2", name: "Unrelated creative" }],
      },
      rows: {
        account: [inScope],
        campaign: [inScope, outOfScope],
        adset: [inScope, outOfScope],
        ad: [inScope, outOfScope],
      },
    });
    await run(db, client);

    assert.equal(await db.syncRun.findFirst({ orderBy: { startedAt: "desc" } }).then((row) => row.campaignId), "campaign-1");
    assert.deepEqual(await db.campaign.findMany({ select: { metaId: true } }), [{ metaId: "campaign-1" }]);
    assert.deepEqual(await db.adSet.findMany({ select: { metaId: true } }), [{ metaId: "adset-1" }]);
    assert.deepEqual(await db.ad.findMany({ select: { metaId: true } }), [{ metaId: "ad-1" }]);
    assert.deepEqual(await db.creative.findMany({ select: { metaId: true } }), [{ metaId: "creative-1" }]);
    assert.equal(await db.dailyInsight.count(), 4);
  } finally {
    if (previousCampaignId === undefined) delete process.env.META_CAMPAIGN_ID;
    else process.env.META_CAMPAIGN_ID = previousCampaignId;
  }
});

test("marks historical metadata as not current when a later successful sync omits it", async () => {
  const db = await createDatabase();
  await run(db, fakeClient().client, new Date("2026-09-04T12:00:00.000Z"));
  const empty = fakeClient({
    metadata: { campaigns: [], adSets: [], ads: [], creatives: [] },
    rows: { account: [], campaign: [], adset: [], ad: [] },
  });
  await run(db, empty.client, new Date("2026-09-05T12:00:00.000Z"));

  const state = await buildDashboardState({ db, now: new Date("2026-09-05T12:30:00.000Z") });
  assert.equal(state.meta.metadataStaleCount, 3);
  assert.equal(state.campaigns[0].isCurrent, false);
  assert.equal(state.adSets[0].isCurrent, false);
  assert.equal(state.ads[0].isCurrent, false);
  assert.equal(state.dataWarnings["7d"].some((warning) => warning.id === "metadata-not-current"), true);
});

test("marks omitted current-window insights unknown while retaining the historical source row", async () => {
  const db = await createDatabase();
  await run(db, fakeClient().client, new Date("2026-09-04T12:00:00.000Z"));
  const empty = fakeClient({
    metadata: { campaigns: [], adSets: [], ads: [], creatives: [] },
    rows: { account: [], campaign: [], adset: [], ad: [] },
  });
  await run(db, empty.client, new Date("2026-09-05T12:00:00.000Z"));

  const state = await buildDashboardState({ db, now: new Date("2026-09-05T12:30:00.000Z") });
  const historical = await db.dailyInsight.findUnique({
    where: {
      date_level_entityId_attributionKey_scopeKey: {
        date: "2026-09-04",
        level: "account",
        entityId: account.id,
        attributionKey: "7d_click,1d_view",
        scopeKey: "account",
      },
    },
  });

  assert.equal(state.scorecard.last7.spendCents, null);
  assert.equal(state.scorecard.last7.leads, null);
  assert.equal(state.ads[0].periods.last7.spendCents, null);
  assert.equal(state.ads[0].isCurrent, false);
  assert.equal(state.dataWarnings["7d"].some((warning) => warning.id === "metadata-not-current"), true);
  assert.equal(historical.spendMinorUnits, 1234);
  assert.equal(historical.leads, 2);
});

test("skips provider insight rows outside the requested range", async () => {
  const db = await createDatabase();
  const { client } = fakeClient({ rows: {
    account: [insight("2026-01-01")],
    campaign: [insight("2026-01-01")],
    adset: [insight("2026-01-01")],
    ad: [insight("2026-01-01")],
  } });
  const result = await run(db, client);
  assert.equal(result.rowsFetched, 8);
  assert.equal(result.rowsWritten, 4);
  assert.match(result.warning, /malformed insight row/);
  assert.equal(await db.dailyInsight.count(), 0);
});
