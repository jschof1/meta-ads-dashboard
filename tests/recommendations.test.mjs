import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";
import {
  analyseRecommendations,
  isValidComparisonWindow,
  metricsFromTotals,
} from "../lib/recommendations.ts";
import { persistRecommendationLifecycle } from "../lib/recommendation-store.ts";
import { readActiveRecommendationViews } from "../lib/recommendation-store.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904210000_pr06_recommendation_engine/migration.sql", import.meta.url),
];
const fixtures = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr06-"));
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

function configWith(overrides = {}) {
  const config = structuredClone(UKTL_CONFIG);
  Object.assign(config.targets, overrides.targets ?? {});
  if (overrides.cpl) Object.assign(config.targets.cpl, overrides.cpl);
  if (overrides.evidence) Object.assign(config.evidence, overrides.evidence);
  return config;
}

function metrics({ spendCents = null, impressions = null, leads = null, linkClicks = null, frequency = null } = {}) {
  return metricsFromTotals({
    spendCents,
    impressions,
    reach: null,
    clicks: null,
    linkClicks,
    leads,
    frequency,
  });
}

function analysis(overrides = {}) {
  const current = overrides.current ?? metrics({ spendCents: 6000, impressions: 6000, leads: 6, linkClicks: 120, frequency: 1.5 });
  const previous = Object.prototype.hasOwnProperty.call(overrides, "previous")
    ? overrides.previous
    : metrics({ spendCents: 9000, impressions: 6000, leads: 6, linkClicks: 120, frequency: 1.5 });
  const cumulative = overrides.cumulative ?? current;
  const series = overrides.series ?? [
    { date: "2026-09-01", metrics: previous },
    { date: "2026-09-02", metrics: previous },
    { date: "2026-09-03", metrics: current },
  ];
  return analyseRecommendations({
    config: overrides.config ?? configWith({ cpl: { targetMinorUnits: 1500, acceptableMinorUnits: 2500, maximumMinorUnits: 3500 } }),
    target: overrides.target ?? { type: "ad", id: "ad-1", name: "Trade lead creative" },
    comparisonDays: overrides.comparisonDays ?? 7,
    current,
    previous,
    cumulative,
    status: overrides.status ?? "ACTIVE",
    learningState: overrides.learningState ?? null,
    series,
    sampleSize: overrides.sampleSize ?? series.length,
    daysActive: overrides.daysActive ?? 14,
    budgetCents: overrides.budgetCents,
  });
}

test("derives ratios from matched numerators and accepts only 3/7/14/30-day windows", () => {
  const current = metrics({ spendCents: 10_000, impressions: 5_000, leads: 5, linkClicks: 250 });
  assert.equal(current.cplCents, 2_000);
  assert.equal(current.cpmCents, 2_000);
  assert.equal(current.ctrLink, 0.05);
  for (const window of [3, 7, 14, 30]) {
    assert.equal(isValidComparisonWindow(window), true);
    assert.equal(analysis({ comparisonDays: window }).recommendations[0].evidence.comparisonDays, window);
  }
  assert.equal(isValidComparisonWindow(5), false);
});

test("keeps invalid negative totals unknown instead of turning them into zeroes", () => {
  const result = metricsFromTotals({
    spendCents: -1,
    impressions: -10,
    reach: -1,
    clicks: -1,
    linkClicks: -1,
    leads: -1,
    frequency: -1,
  });
  assert.equal(result.spendCents, null);
  assert.equal(result.impressions, null);
  assert.equal(result.leads, null);
  assert.equal(result.frequency, null);
  assert.equal(result.cplCents, null);
});

test("keeps zero and tiny samples neutral and inspectable", () => {
  const zero = analysis({
    current: metrics(),
    previous: null,
    cumulative: null,
    series: [],
    sampleSize: 0,
    daysActive: null,
  });
  assert.ok(["hold", "monitor"].includes(zero.recommendations[0].type));
  assert.ok(zero.recommendations.every((item) => item.evidence.current && item.proposedAction && item.reason));

  const tiny = analysis({
    current: metrics({ spendCents: 500, impressions: 999, leads: 1, linkClicks: 10, frequency: 3.5 }),
    previous: metrics({ spendCents: 500, impressions: 999, leads: 1, linkClicks: 10, frequency: 2 }),
    cumulative: metrics({ spendCents: 500, impressions: 999, leads: 1, linkClicks: 10, frequency: 3.5 }),
    sampleSize: 1,
  });
  assert.ok(tiny.recommendations.every((item) => !["pause_candidate", "scale_candidate", "creative_refresh"].includes(item.type)));
  assert.equal(tiny.recommendations[0].confidence, "low");
});

test("returns a scale candidate only for a sufficiently evidenced winner", () => {
  const result = analysis({
    current: metrics({ spendCents: 6000, impressions: 6000, leads: 6, linkClicks: 180, frequency: 1.4 }),
    previous: metrics({ spendCents: 9000, impressions: 6000, leads: 4, linkClicks: 100, frequency: 1.5 }),
  });
  assert.ok(result.recommendations.some((item) => item.type === "scale_candidate"));
  const winner = result.recommendations.find((item) => item.type === "scale_candidate");
  assert.equal(winner.evidence.current.cplCents, 1000);
  assert.equal(winner.evidence.deltas.cplPct, -55.55555555555556);
  assert.equal(winner.target.id, "ad-1");
});

test("does not scale without a sufficient matched baseline", () => {
  const result = analysis({
    previous: null,
    current: metrics({ spendCents: 6000, impressions: 6000, leads: 6, linkClicks: 180, frequency: 1.4 }),
  });
  assert.equal(result.recommendations.some((item) => item.type === "scale_candidate"), false);
});

test("returns a pause candidate only for an evidenced loser outside the maximum CPL", () => {
  const result = analysis({
    current: metrics({ spendCents: 24_000, impressions: 12_000, leads: 6, linkClicks: 120, frequency: 1.5 }),
    previous: metrics({ spendCents: 9_000, impressions: 6_000, leads: 6, linkClicks: 120, frequency: 1.4 }),
  });
  assert.ok(result.recommendations.some((item) => item.type === "pause_candidate"));
  assert.ok(result.recommendations.find((item) => item.type === "pause_candidate").proposedAction.includes("human approval"));
});

test("requires combined deterioration before recommending a creative refresh", () => {
  const stablePerformance = analysis({
    current: metrics({ spendCents: 12_000, impressions: 12_000, leads: 6, linkClicks: 240, frequency: 3.5 }),
    previous: metrics({ spendCents: 12_000, impressions: 6_000, leads: 6, linkClicks: 120, frequency: 2 }),
  });
  assert.equal(stablePerformance.recommendations.some((item) => item.type === "creative_refresh"), false);

  const deteriorating = analysis({
    current: metrics({ spendCents: 24_000, impressions: 12_000, leads: 6, linkClicks: 60, frequency: 3.5 }),
    previous: metrics({ spendCents: 9_000, impressions: 6_000, leads: 6, linkClicks: 240, frequency: 2 }),
  });
  assert.ok(deteriorating.recommendations.some((item) => item.type === "creative_refresh"));
  const fatigue = deteriorating.signals.find((signal) => signal.id === "fatigue");
  assert.equal(fatigue.status, "triggered");
  assert.match(fatigue.reason, /combined/);

  const missingFrequencyBaseline = analysis({
    current: metrics({ spendCents: 18_000, impressions: 12_000, leads: 4, linkClicks: 96, frequency: 3.5 }),
    previous: metrics({ spendCents: 9_000, impressions: 10_000, leads: 6, linkClicks: 160, frequency: null }),
  });
  assert.equal(missingFrequencyBaseline.signals.find((signal) => signal.id === "fatigue").status, "unknown");
  assert.equal(missingFrequencyBaseline.recommendations.some((item) => item.type === "creative_refresh"), false);

  const campaignFatigue = analysis({
    target: { type: "campaign", id: "campaign-1", name: "Prospecting" },
    current: metrics({ spendCents: 18_000, impressions: 12_000, leads: 4, linkClicks: 96, frequency: 3.5 }),
    previous: metrics({ spendCents: 9_000, impressions: 10_000, leads: 6, linkClicks: 160, frequency: 2 }),
  });
  assert.equal(campaignFatigue.recommendations.some((item) => item.type === "creative_refresh"), false);
});

test("keeps one-conversion CPL as monitor evidence rather than a winner or loser", () => {
  const result = analysis({
    current: metrics({ spendCents: 1000, impressions: 2000, leads: 1, linkClicks: 30, frequency: 1.2 }),
    previous: metrics({ spendCents: 1500, impressions: 2000, leads: 1, linkClicks: 30, frequency: 1.1 }),
    cumulative: metrics({ spendCents: 1000, impressions: 2000, leads: 1, linkClicks: 30, frequency: 1.2 }),
    sampleSize: 1,
  });
  assert.equal(result.recommendations[0].type, "monitor");
  assert.equal(result.recommendations.some((item) => ["scale_candidate", "pause_candidate"].includes(item.type)), false);
  assert.equal(result.recommendations[0].evidence.current.cplCents, 1000);
  assert.equal(result.recommendations[0].evidence.series.length, result.recommendations[0].evidence.seriesPoints);
});

test("distinguishes recovery, decline and possible tracking failure", () => {
  const recovery = analysis({
    current: metrics({ spendCents: 6000, impressions: 6000, leads: 6, linkClicks: 120, frequency: 1.2 }),
    previous: metrics({ spendCents: 12_000, impressions: 6000, leads: 4, linkClicks: 120, frequency: 1.2 }),
  });
  assert.equal(recovery.signals.find((signal) => signal.id === "matched-trend").status, "clear");

  const decline = analysis({
    config: configWith(),
    current: metrics({ spendCents: 18_000, impressions: 6000, leads: 3, linkClicks: 60, frequency: 1.2 }),
    previous: metrics({ spendCents: 6000, impressions: 6000, leads: 6, linkClicks: 120, frequency: 1.2 }),
  });
  assert.equal(decline.recommendations[0].type, "monitor");
  assert.equal(decline.signals.find((signal) => signal.id === "matched-trend").status, "triggered");

  const tracking = analysis({
    current: metrics({ spendCents: 6000, impressions: 6000, leads: null, linkClicks: 120, frequency: 1.2 }),
    previous: metrics({ spendCents: 6000, impressions: 6000, leads: 4, linkClicks: 120, frequency: 1.2 }),
  });
  assert.equal(tracking.recommendations[0].type, "possible_tracking_issue");
  assert.equal(tracking.recommendations[0].severity, "alert");
});

test("holds or monitors paused, new and learning entities", () => {
  const paused = analysis({ status: "PAUSED" });
  assert.equal(paused.recommendations[0].type, "hold");
  const fresh = analysis({ daysActive: 2 });
  assert.equal(fresh.recommendations[0].type, "monitor");
  const learning = analysis({ learningState: "LEARNING", daysActive: 14 });
  assert.equal(learning.recommendations[0].type, "monitor");
  for (const result of [paused, fresh, learning]) {
    assert.ok(result.recommendations.every((item) => item.evidence.thresholds.minLeads >= 0));
  }
});

test("creates a budget watch from target-relative cumulative spend", () => {
  const result = analysis({
    config: configWith({ targets: { monthlyBudgetMinorUnits: 30_000 } }),
    cumulative: metrics({ spendCents: 20_000, impressions: 10_000, leads: 5, linkClicks: 100, frequency: 1.2 }),
    daysActive: 10,
  });
  const budget = result.recommendations.find((item) => item.type === "budget_watch");
  assert.ok(budget);
  assert.equal(budget.evidence.thresholds.expectedSpendCents, 10_000);
  assert.equal(budget.evidence.thresholds.budgetCents, 30_000);

  const noEntityBudget = analysis({
    config: configWith({ targets: { monthlyBudgetMinorUnits: 30_000 } }),
    budgetCents: null,
    cumulative: metrics({ spendCents: 20_000, impressions: 10_000, leads: 5, linkClicks: 100, frequency: 1.2 }),
    daysActive: 10,
  });
  assert.equal(noEntityBudget.recommendations.some((item) => item.type === "budget_watch"), false);
  assert.equal(noEntityBudget.recommendations[0].evidence.thresholds.expectedSpendCents, null);
});

test("persists, deduplicates, resolves and reopens a recommendation lifecycle", async () => {
  const db = await createDatabase();
  const recommendation = analysis({}).recommendations[0];
  const firstAt = new Date("2026-09-04T12:00:00.000Z");
  const secondAt = new Date("2026-09-05T12:00:00.000Z");
  const scope = {
    accountId: "act_uktl-test",
    campaignId: null,
    attributionKey: "7d_click,1d_view",
    syncRunId: "run-one",
    now: firstAt,
  };

  assert.deepEqual(await persistRecommendationLifecycle(db, { ...scope, recommendations: [recommendation] }), {
    created: 1,
    updated: 0,
    resolved: 0,
    active: 1,
  });
  assert.deepEqual(await persistRecommendationLifecycle(db, { ...scope, syncRunId: "run-two", now: secondAt, recommendations: [recommendation, recommendation] }), {
    created: 0,
    updated: 1,
    resolved: 0,
    active: 1,
  });
  assert.equal(await db.recommendation.count(), 1);
  const stored = await db.recommendation.findFirst();
  assert.equal(stored.lifecycle, "OPEN");
  assert.equal(stored.sourceSyncRunId, "run-two");
  assert.deepEqual(JSON.parse(stored.evidence).current, recommendation.evidence.current);

  await persistRecommendationLifecycle(db, {
    ...scope,
    syncRunId: "late-run",
    now: new Date("2026-09-04T13:00:00.000Z"),
    recommendations: [{ ...recommendation, reason: "Late stale analysis" }],
  });
  const afterLate = await db.recommendation.findFirst();
  assert.equal(afterLate.sourceSyncRunId, "run-two");
  assert.equal(afterLate.reason, stored.reason);
  assert.equal(afterLate.lastSeenAt.toISOString(), secondAt.toISOString());

  const resolved = await persistRecommendationLifecycle(db, { ...scope, syncRunId: "run-three", now: new Date("2026-09-06T12:00:00.000Z"), recommendations: [] });
  assert.equal(resolved.resolved, 1);
  assert.equal(await db.recommendation.findFirst().then((row) => row.lifecycle), "RESOLVED");

  await persistRecommendationLifecycle(db, { ...scope, syncRunId: "run-warning", now: new Date("2026-09-06T18:00:00.000Z"), recommendations: [recommendation] });
  const beforePartial = await db.recommendation.findFirst();
  await persistRecommendationLifecycle(db, {
    ...scope,
    syncRunId: "run-partial",
    now: new Date("2026-09-06T19:00:00.000Z"),
    recommendations: [],
    reconcile: false,
  });
  const afterPartial = await db.recommendation.findFirst();
  assert.equal(afterPartial.lifecycle, "OPEN");
  assert.equal(afterPartial.lastSeenAt.toISOString(), beforePartial.lastSeenAt.toISOString());

  await persistRecommendationLifecycle(db, { ...scope, syncRunId: "run-four", now: new Date("2026-09-07T12:00:00.000Z"), recommendations: [recommendation] });
  const reopened = await db.recommendation.findFirst();
  assert.equal(reopened.lifecycle, "OPEN");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.firstSeenAt.toISOString(), firstAt.toISOString());
  assert.equal(reopened.lastSeenAt.toISOString(), "2026-09-07T12:00:00.000Z");
});

test("reads only validated active recommendations in the exact dashboard scope", async () => {
  const db = await createDatabase();
  const recommendation = analysis({}).recommendations[0];
  const scope = {
    accountId: "act_scope-one",
    campaignId: null,
    attributionKey: "7d_click,1d_view",
    syncRunId: "scope-run",
    now: new Date("2026-09-04T12:00:00.000Z"),
  };
  await persistRecommendationLifecycle(db, { ...scope, recommendations: [recommendation] });
  await persistRecommendationLifecycle(db, {
    ...scope,
    accountId: "act_scope-two",
    syncRunId: "other-run",
    recommendations: [recommendation],
  });

  const views = await readActiveRecommendationViews(db, {
    accountId: scope.accountId,
    campaignId: scope.campaignId,
    attributionKey: scope.attributionKey,
  });
  assert.equal(views.length, 1);
  assert.equal(views[0].type, recommendation.type);
  assert.equal(views[0].target.id, recommendation.target.id);
  assert.equal(views[0].evidence.evidenceVersion, 1);
  assert.equal("signals" in views[0], false);
});
