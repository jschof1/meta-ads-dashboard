import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { buildDataWarnings, buildDataWarningsByPeriod, buildDashboardState, aggregateInsights } from "../lib/read-model.ts";
import { evidenceForBucket, frequencyEvidenceForBucket, ratioDelta } from "../lib/dashboard-metrics.ts";
import { comparisonBucket, comparisonInstruction, currentBucket } from "../lib/dashboard-periods.ts";
import { buildSpendStatus } from "../lib/spend-status.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
];
const fixtures = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr05-"));
  const path = join(directory, "test.db");
  const db = createPrismaClient({ url: `file:${path}` });
  for (const migrationPath of migrationPaths) {
    const migration = await readFile(migrationPath, "utf8");
    const statements = migration.split(/;\s*(?:\n|$)/g).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  }
  fixtures.push({ db, directory });
  return db;
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await fixture.db.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function metricRow(date, values = {}) {
  return {
    date,
    currencyCode: "GBP",
    spendMinorUnits: 1000,
    impressions: 1000,
    reach: 500,
    clicks: 100,
    linkClicks: 50,
    leads: 2,
    frequency: 2,
    ...values,
  };
}

test("aggregates numerators and derives CPC, CPL, CPM and CTR from matched totals", () => {
  const bucket = aggregateInsights([
    metricRow("2026-09-03", { spendMinorUnits: 2000, impressions: 1000, clicks: 100, linkClicks: 50, leads: 4, frequency: 2 }),
    metricRow("2026-09-04", { spendMinorUnits: 1000, impressions: 2000, clicks: 100, linkClicks: 100, leads: 2, frequency: 1 }),
  ]);
  assert.equal(bucket.spendCents, 3000);
  assert.equal(bucket.leads, 6);
  assert.equal(bucket.cplCents, 500);
  assert.equal(bucket.cpcCents, 15);
  assert.equal(bucket.cpmCents, 1000);
  assert.equal(bucket.ctrLink, 0.05);
  assert.equal(bucket.frequency, 1.3333333333333333);
  assert.equal(aggregateInsights([metricRow("2026-09-04", { impressions: 1000, reach: 500, frequency: 2 })]).frequency, 2);
  assert.equal(ratioDelta(bucket.cplCents, 500), 0);
  assert.equal(ratioDelta(bucket.cpcCents, 30), -50);
});

test("maps every operator period to its matched comparison bucket", () => {
  const marker = (spendMinorUnits) => aggregateInsights([metricRow("2026-09-04", { spendMinorUnits })]);
  const periods = {
    today: marker(1),
    yesterday: marker(2),
    mtd: marker(3),
    previousMtd: marker(4),
    last7: marker(5),
    previous7: marker(6),
    last14: marker(7),
    previous14: marker(8),
    last30: marker(9),
    previous30: marker(10),
  };
  const expected = [
    ["today", "today", "yesterday"],
    ["7d", "last7", "previous7"],
    ["14d", "last14", "previous14"],
    ["30d", "last30", "previous30"],
    ["mtd", "mtd", "previousMtd"],
  ];
  for (const [period, current, comparison] of expected) {
    assert.equal(currentBucket(periods, period).spendCents, periods[current].spendCents);
    assert.equal(comparisonBucket(periods, period).spendCents, periods[comparison].spendCents);
    assert.match(comparisonInstruction(period, true), /compares with/);
  }
  assert.match(comparisonInstruction("mtd", false), /withheld/);
});

test("keeps evidence neutral until configured thresholds are met", () => {
  const unknown = evidenceForBucket(aggregateInsights([metricRow("2026-09-04", { leads: null })]));
  assert.equal(unknown.status, "unknown");
  const missingImpressions = evidenceForBucket(aggregateInsights([metricRow("2026-09-04", { impressions: null, leads: 3 })]));
  assert.equal(missingImpressions.status, "unknown");
  const thin = evidenceForBucket(aggregateInsights([metricRow("2026-09-04", { impressions: 999, leads: 2 })]));
  assert.equal(thin.status, "thin");
  const sufficient = evidenceForBucket(aggregateInsights([metricRow("2026-09-04", { impressions: 1000, leads: 3 })]));
  assert.equal(sufficient.status, "sufficient");
  assert.equal(frequencyEvidenceForBucket(aggregateInsights([metricRow("2026-09-04", { frequency: null })])).status, "unknown");
  const thinFrequency = frequencyEvidenceForBucket(aggregateInsights([metricRow("2026-09-04", { frequency: 2, impressions: 999, leads: 2 })]));
  assert.equal(thinFrequency.status, "thin");
  assert.match(thinFrequency.reason, /Thin sample:.*weighted daily diagnostic/);
  const sufficientFrequency = frequencyEvidenceForBucket(aggregateInsights([metricRow("2026-09-04", { frequency: 2, leads: 3 })]));
  assert.equal(sufficientFrequency.status, "sufficient");
  assert.match(sufficientFrequency.reason, /impression-weighted average/);
});

test("classifies MTD spend pace only from stored spend and an explicit monthly budget", () => {
  assert.equal(buildSpendStatus({ spendCents: 1000, budgetCents: 31000, localDate: "2026-09-04" }).status, "under_pace");
  assert.equal(buildSpendStatus({ spendCents: 4000, budgetCents: 31000, localDate: "2026-09-04" }).status, "on_pace");
  assert.equal(buildSpendStatus({ spendCents: 7000, budgetCents: 31000, localDate: "2026-09-04" }).status, "over_pace");
  assert.equal(buildSpendStatus({ spendCents: 32000, budgetCents: 31000, localDate: "2026-09-04" }).status, "over_budget");
  assert.equal(buildSpendStatus({ spendCents: 1000, budgetCents: null, localDate: "2026-09-04" }).status, "unknown");
});

test("builds a durable state with matched MTD, entity drill-downs, budgets and provider change timestamps", async () => {
  const db = await createDatabase();
  const previousAccountId = process.env.META_AD_ACCOUNT_ID;
  const previousCampaignId = process.env.META_CAMPAIGN_ID;
  process.env.META_AD_ACCOUNT_ID = "act_pr05-account";
  delete process.env.META_CAMPAIGN_ID;
  try {
    await db.syncRun.create({
      data: {
        id: "pr05-run",
        accountId: "act_pr05-account",
        accountName: "UK Trade Leads",
        currencyCode: "GBP",
        timezoneName: "Europe/London",
        trigger: "manual",
        status: "SUCCEEDED",
        attributionKey: "7d_click,1d_view",
        startedAt: new Date("2026-09-04T12:00:00.000Z"),
        finishedAt: new Date("2026-09-04T12:01:00.000Z"),
      },
    });
    await db.campaign.create({
      data: { metaId: "pr05-campaign", name: "UKTL Prospecting", objective: "OUTCOME_LEADS", effectiveStatus: "ACTIVE", dailyBudgetMinor: 10000, lifetimeBudgetMinor: 250000, lastSeenSyncRunId: "pr05-run" },
    });
    await db.adSet.create({
      data: { metaId: "pr05-adset", campaignMetaId: "pr05-campaign", name: "Trade businesses", effectiveStatus: "ACTIVE", dailyBudgetMinor: 5000, lifetimeBudgetMinor: 120000, learningStage: "LEARNING", lastSeenSyncRunId: "pr05-run" },
    });
    await db.ad.create({
      data: { metaId: "pr05-ad", campaignMetaId: "pr05-campaign", adSetMetaId: "pr05-adset", name: "Lead generation creative", effectiveStatus: "ACTIVE", creativeMetaId: "pr05-creative", providerUpdatedAt: new Date("2026-09-04T10:02:00.000Z"), lastSeenSyncRunId: "pr05-run" },
    });
    await db.creative.create({
      data: { metaId: "pr05-creative", title: "More enquiries", body: "Talk to a local trades lead specialist.", callToActionType: "LEARN_MORE", format: "image", thumbnailUrl: "https://example.test/creative.jpg", destinationUrl: "https://example.test/book", providerUpdatedAt: new Date("2026-09-04T10:03:00.000Z"), lastSeenSyncRunId: "pr05-run" },
    });
    await db.campaign.create({
      data: { metaId: "pr05-zero-campaign", name: "Paused no-delivery campaign", objective: "OUTCOME_LEADS", effectiveStatus: "PAUSED", lastSeenSyncRunId: "pr05-run" },
    });
    await db.adSet.create({
      data: { metaId: "pr05-zero-adset", campaignMetaId: "pr05-zero-campaign", name: "Paused no-delivery ad set", effectiveStatus: "PAUSED", dailyBudgetMinor: 3000, learningStage: "LEARNING_LIMITED", lastSeenSyncRunId: "pr05-run" },
    });

    const dates = [
      ["2026-09-01", { spendMinorUnits: 2000, impressions: 1000, clicks: 100, linkClicks: 50, leads: 4 }],
      ["2026-09-03", { spendMinorUnits: 2000, impressions: 1000, clicks: 100, linkClicks: 50, leads: 4 }],
      ["2026-09-04", { spendMinorUnits: 1000, impressions: 2000, clicks: 100, linkClicks: 100, leads: 2 }],
      ["2026-08-25", { spendMinorUnits: 1500, impressions: 1000, clicks: 50, linkClicks: 50, leads: 3 }],
      ["2026-08-04", { spendMinorUnits: 3000, impressions: 1000, clicks: 100, linkClicks: 50, leads: 3 }],
    ];
    const levels = [
      ["account", "act_pr05-account"],
      ["campaign", "pr05-campaign"],
      ["adset", "pr05-adset"],
      ["ad", "pr05-ad"],
    ];
    await db.dailyInsight.createMany({
      data: levels.flatMap(([level, entityId]) => dates.map(([date, values]) => ({
        ...metricRow(date, values),
        level,
        entityId,
        attributionKey: "7d_click,1d_view",
        syncRunId: "pr05-run",
      }))),
    });

    const state = await buildDashboardState({ db, now: new Date("2026-09-04T12:30:00.000Z") });
    assert.equal(state.meta.accountName, "UK Trade Leads");
    assert.equal(state.meta.mtdComparisonComparable, true);
    assert.equal(state.campaigns.find((campaign) => campaign.campaignId === "pr05-campaign").status, "ACTIVE");
    assert.equal(state.adSets.find((adSet) => adSet.adSetId === "pr05-adset").status, "ACTIVE");
    assert.equal(state.adSets.find((adSet) => adSet.adSetId === "pr05-adset").learningStage, "LEARNING");
    assert.equal(state.scorecard.last7.spendCents, 5000);
    assert.equal(state.scorecard.last7.leads, 10);
    assert.equal(state.scorecard.last7.cplCents, 500);
    assert.equal(state.scorecard.last7.cpcCents, 17);
    assert.equal(state.scorecard.previous7.spendCents, 1500);
    assert.equal(state.scorecard.previous7.cpcCents, 30);
    assert.equal(state.scorecard.mtd.spendCents, 5000);
    assert.equal(state.scorecard.previousMtd.spendCents, 3000);
    assert.equal(state.campaigns.find((campaign) => campaign.campaignId === "pr05-campaign").periods.last7.leads, 10);
    assert.equal(state.campaigns.find((campaign) => campaign.campaignId === "pr05-campaign").dailyBudgetMinor, 10000);
    assert.equal(state.campaigns.find((campaign) => campaign.campaignId === "pr05-campaign").lifetimeBudgetMinor, 250000);
    assert.equal(state.campaigns.some((campaign) => campaign.campaignId === "pr05-zero-campaign"), true);
    assert.equal(state.adSets.find((adSet) => adSet.adSetId === "pr05-adset").dailyBudgetMinor, 5000);
    assert.equal(state.adSets.some((adSet) => adSet.adSetId === "pr05-zero-adset"), true);
    assert.equal(state.adSets.find((adSet) => adSet.adSetId === "pr05-adset").learningStage, "LEARNING");
    assert.equal(state.ads[0].lastChangeAt, "2026-09-04T10:03:00.000Z");
    assert.equal(state.ads[0].format, "image");
    assert.equal(state.ads[0].evidence["7d"].status, "sufficient");
    assert.deepEqual(Object.fromEntries(Object.entries(state.dataWarnings).map(([period, warnings]) => [period, warnings.length])), {
      today: 0,
      "7d": 0,
      "14d": 0,
      "30d": 0,
      mtd: 0,
    });
    const monthEndState = await buildDashboardState({ db, now: new Date("2026-03-31T12:30:00.000Z") });
    assert.equal(monthEndState.meta.mtdComparisonComparable, false);
    assert.equal(monthEndState.dataWarnings.mtd.some((warning) => warning.id === "mtd-shorter-comparison"), true);
  } finally {
    if (previousAccountId === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = previousAccountId;
    if (previousCampaignId === undefined) delete process.env.META_CAMPAIGN_ID;
    else process.env.META_CAMPAIGN_ID = previousCampaignId;
  }
});

test("surfaces sync and tracking warnings without converting missing results into zeroes", () => {
  const bucket = aggregateInsights([metricRow("2026-09-04", { spendMinorUnits: 1200, impressions: 1000, leads: null })]);
  const previous = aggregateInsights([metricRow("2026-08-28", { spendMinorUnits: 1000, impressions: 1000, leads: 3 })]);
  const missing = buildDataWarnings({ state: "fresh", current: bucket, comparison: previous });
  assert.deepEqual(missing.map((warning) => warning.id), ["missing-lead-event"]);

  const disappearing = buildDataWarnings({
    state: "fresh",
    current: aggregateInsights([metricRow("2026-09-04", { spendMinorUnits: 1200, impressions: 1000, leads: 0 })]),
    comparison: previous,
  });
  assert.deepEqual(disappearing.map((warning) => warning.id), ["spend-without-results", "disappearing-events"]);
});

test("builds data-quality warnings against the selected period and its matched comparison", () => {
  const current = aggregateInsights([metricRow("2026-09-04", { spendMinorUnits: 1200, impressions: 1000, leads: 0 })]);
  const comparison = aggregateInsights([metricRow("2026-09-03", { spendMinorUnits: 1000, impressions: 1000, leads: 3 })]);
  const empty = aggregateInsights([]);
  const buckets = {
    today: current,
    yesterday: comparison,
    mtd: empty,
    previousMtd: empty,
    last7: empty,
    previous7: empty,
    last14: empty,
    previous14: empty,
    last30: empty,
    previous30: empty,
  };
  const warnings = buildDataWarningsByPeriod({ state: "fresh", buckets });
  assert.deepEqual(warnings.today.map((warning) => warning.id), ["spend-without-results", "disappearing-events"]);
  assert.deepEqual(warnings["7d"], []);
});

test("withholds MTD comparison warnings when the prior month is shorter", () => {
  const empty = aggregateInsights([]);
  const buckets = {
    today: empty,
    yesterday: empty,
    mtd: aggregateInsights([metricRow("2026-03-31", { spendMinorUnits: 1200, impressions: 1000, leads: 3 })]),
    previousMtd: aggregateInsights([metricRow("2026-02-28", { spendMinorUnits: 1000, impressions: 1000, leads: 3 })]),
    last7: empty,
    previous7: empty,
    last14: empty,
    previous14: empty,
    last30: empty,
    previous30: empty,
  };
  const warnings = buildDataWarningsByPeriod({ state: "fresh", buckets, mtdComparisonComparable: false });
  assert.deepEqual(warnings.mtd.map((warning) => warning.id), ["mtd-shorter-comparison"]);
});
