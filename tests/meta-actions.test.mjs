import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";
import { analyseRecommendations, metricsFromTotals } from "../lib/recommendations.ts";
import {
  MetaActionError,
  MetaActionProviderError,
  approveMetaAction,
  executeMetaAction,
  loadMetaActionConfig,
  metaActionGate,
  proposeMetaAction,
  rejectMetaAction,
  readMetaActionViews,
} from "../lib/meta-actions.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904210000_pr06_recommendation_engine/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260905143000_pr09_approved_meta_actions/migration.sql", import.meta.url),
];
const fixtures = [];

beforeEach((context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T12:00:00.000Z") });
});

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr09-"));
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

const ACCOUNT_ID = "act_pr09-account";
const ATTRIBUTION_KEY = "7d_click,1d_view";

function environment(overrides = {}) {
  return {
    META_WRITES_ENABLED: "false",
    META_MARKETING_TOKEN: "test-token-that-must-never-be-stored",
    META_AD_ACCOUNT_ID: ACCOUNT_ID,
    META_GRAPH_VERSION: "v25.0",
    META_ACTION_MAX_DAILY_BUDGET_MINOR: "20000",
    META_ACTION_MAX_BUDGET_CHANGE_PERCENT: "20",
    ...overrides,
  };
}

function metrics({ spendCents, impressions, leads, linkClicks, frequency }) {
  return metricsFromTotals({ spendCents, impressions, leads, linkClicks, frequency, reach: null, clicks: null });
}

function recommendationFor(target, type, status = "ACTIVE") {
  const config = structuredClone(UKTL_CONFIG);
  config.targets.cpl.targetMinorUnits = 1_500;
  config.targets.cpl.acceptableMinorUnits = 2_500;
  config.targets.cpl.maximumMinorUnits = 3_500;
  const result = analyseRecommendations({
    config,
    target,
    comparisonDays: 7,
    current: type === "pause_candidate"
      ? metrics({ spendCents: 24_000, impressions: 12_000, leads: 6, linkClicks: 120, frequency: 1.5 })
      : type === "scale_candidate"
        ? metrics({ spendCents: 6_000, impressions: 6_000, leads: 6, linkClicks: 180, frequency: 1.4 })
        : metrics({ spendCents: 6_000, impressions: 6_000, leads: 6, linkClicks: 120, frequency: 1.4 }),
    previous: type === "pause_candidate"
      ? metrics({ spendCents: 9_000, impressions: 6_000, leads: 6, linkClicks: 120, frequency: 1.4 })
      : metrics({ spendCents: 9_000, impressions: 6_000, leads: 4, linkClicks: 100, frequency: 1.5 }),
    cumulative: metrics({ spendCents: 6_000, impressions: 6_000, leads: 6, linkClicks: 120, frequency: 1.4 }),
    status,
    learningState: null,
    series: [
      { date: "2026-09-01", metrics: metrics({ spendCents: 3_000, impressions: 2_000, leads: 2, linkClicks: 40, frequency: 1.2 }) },
      { date: "2026-09-02", metrics: metrics({ spendCents: 3_000, impressions: 2_000, leads: 2, linkClicks: 40, frequency: 1.3 }) },
      { date: "2026-09-03", metrics: metrics({ spendCents: 3_000, impressions: 2_000, leads: 2, linkClicks: 40, frequency: 1.4 }) },
    ],
    sampleSize: 3,
    daysActive: 14,
  });
  const recommendation = result.recommendations.find((item) => item.type === type);
  assert.ok(recommendation, `fixture did not produce ${type}`);
  return recommendation;
}

async function seedFixture(db, { targetType = "ad", targetStatus = "ACTIVE", dailyBudgetMinor = null, recommendationType = "pause_candidate", campaignId = null, attributionKey = ATTRIBUTION_KEY } = {}) {
  const now = new Date("2026-09-05T12:00:00.000Z");
  const runId = `run-${targetType}-${recommendationType}-${campaignId ?? "account"}-${attributionKey.replaceAll(",", "-")}`;
  await db.syncRun.create({
    data: {
      id: runId,
      accountId: ACCOUNT_ID,
      campaignId,
      trigger: "test",
      status: "SUCCEEDED",
      attributionKey,
      startedAt: new Date("2026-09-05T11:59:00.000Z"),
      finishedAt: now,
    },
  });
  const targetId = targetType === "ad" ? "ad-pr09" : "adset-pr09";
  if (targetType === "ad") {
    await db.ad.create({
      data: {
        id: `db-${targetId}`,
        metaId: targetId,
        campaignMetaId: campaignId,
        name: "Stored UKTL target",
        configuredStatus: targetStatus,
        effectiveStatus: targetStatus,
        lastSeenSyncRunId: runId,
        raw: "{}",
        createdAt: now,
        updatedAt: now,
      },
    });
  } else {
    await db.adSet.create({
      data: {
        id: `db-${targetId}`,
        metaId: targetId,
        campaignMetaId: campaignId,
        name: "Stored UKTL ad set",
        configuredStatus: targetStatus,
        effectiveStatus: targetStatus,
        dailyBudgetMinor,
        lastSeenSyncRunId: runId,
        raw: "{}",
        learningStageInfo: "{}",
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  const recommendation = recommendationFor(
    { type: targetType, id: targetId, name: "Forged client name must not win" },
    recommendationType,
    targetStatus,
  );
  const fingerprint = `${ACCOUNT_ID}|${campaignId ?? "account"}|${attributionKey}|${recommendation.key}`;
  await db.recommendation.create({
    data: {
      id: `recommendation-${targetId}`,
      fingerprint,
      accountId: ACCOUNT_ID,
      campaignId,
      attributionKey,
      type: recommendation.type,
      analysisWindowDays: recommendation.evidence.comparisonDays,
      ruleVersion: "pr06.v1",
      targetType: recommendation.target.type,
      targetId: recommendation.target.id,
      targetName: recommendation.target.name,
      severity: recommendation.severity,
      confidence: recommendation.confidence,
      lifecycle: "OPEN",
      reason: recommendation.reason,
      evidence: JSON.stringify(recommendation.evidence),
      proposedAction: recommendation.proposedAction,
      sourceSyncRunId: runId,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { runId, targetId, fingerprint, recommendation };
}

async function preparePause(db, env = environment()) {
  const fixture = await seedFixture(db);
  const result = await proposeMetaAction(db, {
    recommendationFingerprint: fixture.fingerprint,
    action: "pause_ad",
    forgedReason: "do not copy this",
    targetId: "forged-target",
  }, { env });
  return { fixture, result };
}

function providerFor(state, overrides = {}) {
  let current = { ...state };
  const calls = { readAd: 0, readAdSet: 0, updateAdStatus: 0, updateAdSetDailyBudget: 0 };
  return {
    calls,
    provider: {
      readAd: async (id) => {
        calls.readAd += 1;
        if (overrides.readAd) return overrides.readAd(id, current);
        return { ...current, id };
      },
      readAdSet: async (id) => {
        calls.readAdSet += 1;
        if (overrides.readAdSet) return overrides.readAdSet(id, current);
        return { ...current, id };
      },
      updateAdStatus: async (id, status) => {
        calls.updateAdStatus += 1;
        if (overrides.updateAdStatus) return overrides.updateAdStatus(id, status, current);
        current = { ...current, id, status };
        return { objectId: id, traceId: "trace-pr09" };
      },
      updateAdSetDailyBudget: async (id, dailyBudgetMinor) => {
        calls.updateAdSetDailyBudget += 1;
        if (overrides.updateAdSetDailyBudget) return overrides.updateAdSetDailyBudget(id, dailyBudgetMinor, current);
        current = { ...current, id, dailyBudgetMinor };
        return { objectId: id, traceId: "trace-pr09-budget" };
      },
    },
  };
}

test("Meta write configuration is disabled by default and invalid configuration never enables it", () => {
  const disabled = loadMetaActionConfig({ META_WRITES_ENABLED: "false" });
  assert.equal(disabled.writesEnabled, false);
  assert.equal(metaActionGate({ META_WRITES_ENABLED: "false" }).status, "disabled");

  const invalidEnvironment = {
    META_WRITES_ENABLED: "true",
    META_MARKETING_TOKEN: "secret",
    META_AD_ACCOUNT_ID: ACCOUNT_ID,
    META_ACTION_MAX_DAILY_BUDGET_MINOR: "not-an-integer",
    META_ACTION_MAX_BUDGET_CHANGE_PERCENT: "0",
  };
  const invalid = loadMetaActionConfig(invalidEnvironment);
  assert.equal(invalid.writesEnabled, false);
  assert.ok(invalid.errors.length >= 2);
  assert.equal(metaActionGate(invalidEnvironment).writesEnabled, false);
});

test("proposal is recommendation-bound, copies server evidence, and is idempotent", async () => {
  const db = await createDatabase();
  const { fixture, result } = await preparePause(db);
  assert.equal(result.duplicate, false);
  assert.equal(result.action.status, "PROPOSED");
  assert.equal(result.action.targetId, fixture.targetId);
  assert.equal(result.action.targetName, "Stored UKTL target");
  assert.equal(result.action.reasoning, fixture.recommendation.reason);
  assert.deepEqual(result.action.evidence, fixture.recommendation.evidence);
  assert.deepEqual(result.action.requestedChange, { status: "PAUSED" });
  assert.equal(result.action.source, "operator");
  assert.equal(JSON.stringify(result).includes("test-token-that-must-never-be-stored"), false);

  const duplicate = await proposeMetaAction(db, {
    recommendationFingerprint: fixture.fingerprint,
    action: "pause_ad",
    forgedReason: "different request",
  }, { env: environment() });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.action.id, result.action.id);
  assert.equal(await db.metaAction.count(), 1);
});

test("an explicit idempotency key cannot be reused for a different action payload", async () => {
  const db = await createDatabase();
  const ad = await seedFixture(db);
  await proposeMetaAction(db, {
    recommendationFingerprint: ad.fingerprint,
    action: "pause_ad",
    idempotencyKey: "fixed-operator-key",
  }, { env: environment() });
  const adSet = await seedFixture(db, { targetType: "adset", dailyBudgetMinor: 10_000, recommendationType: "scale_candidate" });
  await assert.rejects(
    proposeMetaAction(db, {
      recommendationFingerprint: adSet.fingerprint,
      action: "set_adset_daily_budget",
      dailyBudgetMinor: 12_000,
      idempotencyKey: "fixed-operator-key",
    }, { env: environment() }),
    (error) => error instanceof MetaActionError && error.code === "conflict" && /already bound/.test(error.message),
  );
  assert.equal(await db.metaAction.count(), 1);
});

test("unsupported recommendation types and forged action fields cannot prepare mutations", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db);
  await db.recommendation.update({ where: { fingerprint: fixture.fingerprint }, data: { type: "monitor" } });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad", reason: "forged" }, { env: environment() }),
    (error) => error instanceof MetaActionError && error.code === "validation",
  );
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "delete_campaign" }, { env: environment() }),
    (error) => error instanceof MetaActionError && error.code === "validation",
  );
  assert.equal(await db.metaAction.count(), 0);
});

test("approval is explicit, execution is impossible while disabled, and transitions are one-way", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  const disabledProvider = providerFor({ id: "ad-pr09", accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment(), provider: disabledProvider.provider }), /Only an approved/);
  const approved = await approveMetaAction(db, result.action.id, { env: environment() });
  assert.equal(approved.action.status, "APPROVED");
  await assert.rejects(approveMetaAction(db, result.action.id, { env: environment() }), /Only a proposed/);
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment(), provider: disabledProvider.provider }), /disabled/);
  assert.equal((await db.metaAction.findUnique({ where: { id: result.action.id } })).status, "APPROVED");
  assert.deepEqual(disabledProvider.calls, { readAd: 0, readAdSet: 0, updateAdStatus: 0, updateAdSetDailyBudget: 0 });
});

test("rejection is explicit, records the actor, and prevents later approval or execution", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  const rejectedAt = new Date("2026-09-05T12:05:00.000Z");
  const rejected = await rejectMetaAction(db, result.action.id, { env: environment(), actor: "jack", now: rejectedAt });
  assert.equal(rejected.action.status, "REJECTED");
  assert.equal(rejected.action.rejectedBy, "jack");
  assert.equal(rejected.action.rejectedAt, rejectedAt.toISOString());
  await assert.rejects(approveMetaAction(db, result.action.id, { env: environment() }), /Only a proposed/);
  const provider = providerFor({ id: result.action.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: provider.provider }), /Only an approved/);
  assert.deepEqual(provider.calls, { readAd: 0, readAdSet: 0, updateAdStatus: 0, updateAdSetDailyBudget: 0 });
});

test("successful pause is read-verified, audited with old/new values, and duplicate execute does not POST again", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  const mocked = providerFor({ id: "ad-pr09", accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  const executed = await executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider });
  assert.equal(executed.action.status, "EXECUTED");
  assert.deepEqual(executed.action.oldValue, { status: "ACTIVE" });
  assert.deepEqual(executed.action.newValue, { status: "PAUSED" });
  assert.equal(executed.action.metaObjectId, "ad-pr09");
  assert.equal(executed.action.metaTraceId, "trace-pr09");
  assert.equal(mocked.calls.updateAdStatus, 1);
  assert.equal(mocked.calls.readAd, 2);
  const log = await db.actionLog.findFirst({ where: { metaActionId: result.action.id } });
  assert.equal(log.executor, "operator");
  assert.equal(JSON.parse(log.oldValue).status, "ACTIVE");
  assert.equal(JSON.parse(log.newValue).status, "PAUSED");
  assert.match(log.metaReference, /meta:ad-pr09 trace:trace-pr09/);
  assert.equal(log.result.includes("test-token"), false);

  const duplicate = await executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider });
  assert.equal(duplicate.duplicate, true);
  assert.equal(mocked.calls.updateAdStatus, 1);
  assert.equal(await db.actionLog.count(), 1);
});

test("enabled execution wires the default provider through GET, one POST, reread and audit", async () => {
  const db = await createDatabase();
  const { fixture, result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  const calls = [];
  let reads = 0;
  const env = environment({ META_WRITES_ENABLED: "true" });
  const executed = await executeMetaAction(db, result.action.id, {
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === "POST") {
        return new Response(JSON.stringify({ id: fixture.targetId, success: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-fb-trace-id": "trace-default-provider" },
        });
      }
      reads += 1;
      return new Response(JSON.stringify({
        id: fixture.targetId,
        account_id: ACCOUNT_ID,
        status: reads === 1 ? "ACTIVE" : "PAUSED",
        effective_status: reads === 1 ? "ACTIVE" : "PAUSED",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(executed.action.status, "EXECUTED");
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET", "POST", "GET"]);
  assert.equal(calls.filter(({ init }) => init.method === "POST").length, 1);
  assert.equal(calls[1].url, "https://graph.facebook.com/v25.0/ad-pr09");
  assert.equal(calls[1].init.body, "status=PAUSED");
  assert.equal(calls[1].init.headers.Authorization, "Bearer test-token-that-must-never-be-stored");
  assert.equal(executed.action.metaTraceId, "trace-default-provider");
  assert.equal(await db.actionLog.count(), 1);
});

test("enabled execution requires a server token before claiming the approved action", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  await assert.rejects(
    executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true", META_MARKETING_TOKEN: "" }) }),
    (error) => error instanceof MetaActionError && error.code === "configuration" && /not safely configured/.test(error.message),
  );
  assert.equal((await db.metaAction.findUnique({ where: { id: result.action.id } })).status, "APPROVED");
});

test("bounded ad-set budget action sends minor units and records the verified change", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db, { targetType: "adset", dailyBudgetMinor: 10_000, recommendationType: "scale_candidate" });
  const proposal = await proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "set_adset_daily_budget", dailyBudgetMinor: 12_000 }, { env: environment() });
  await approveMetaAction(db, proposal.action.id, { env: environment() });
  const mocked = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: 10_000 });
  const executed = await executeMetaAction(db, proposal.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider });
  assert.equal(executed.action.status, "EXECUTED");
  assert.deepEqual(executed.action.oldValue, { dailyBudgetMinor: 10_000 });
  assert.deepEqual(executed.action.newValue, { dailyBudgetMinor: 12_000 });
  assert.equal(mocked.calls.updateAdSetDailyBudget, 1);
  assert.equal(mocked.calls.readAdSet, 2);
});

test("resume is available only from a paused ad hold recommendation and is read-verified", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db, { targetStatus: "PAUSED", recommendationType: "hold" });
  const proposal = await proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "resume_ad" }, { env: environment() });
  assert.deepEqual(proposal.action.requestedChange, { status: "ACTIVE" });
  await approveMetaAction(db, proposal.action.id, { env: environment() });
  const mocked = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "PAUSED", dailyBudgetMinor: null });
  const executed = await executeMetaAction(db, proposal.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider });
  assert.equal(executed.action.status, "EXECUTED");
  assert.equal(mocked.calls.updateAdStatus, 1);
  assert.deepEqual(executed.action.oldValue, { status: "PAUSED" });
  assert.deepEqual(executed.action.newValue, { status: "ACTIVE" });
});

test("invalid budget bounds fail before a provider call", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db, { targetType: "adset", dailyBudgetMinor: 10_000, recommendationType: "scale_candidate" });
  for (const dailyBudgetMinor of [0, -1, 9_999, 10_000, 13_000, 20_001]) {
    await assert.rejects(
      proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "set_adset_daily_budget", dailyBudgetMinor }, { env: environment() }),
      (error) => error instanceof MetaActionError && error.code === "validation",
    );
  }
  assert.equal(await db.metaAction.count(), 0);
});

test("stale successful-sync evidence cannot prepare or execute an approved action", async () => {
  const freshNow = new Date("2026-09-05T12:00:00.000Z");
  const staleNow = new Date("2026-09-07T15:00:00.000Z");

  const proposalDb = await createDatabase();
  const proposalFixture = await seedFixture(proposalDb);
  await assert.rejects(
    proposeMetaAction(proposalDb, { recommendationFingerprint: proposalFixture.fingerprint, action: "pause_ad" }, { env: environment(), now: staleNow }),
    (error) => error instanceof MetaActionError && error.code === "stale" && /evidence is stale/.test(error.message),
  );
  assert.equal(await proposalDb.metaAction.count(), 0);

  const executionDb = await createDatabase();
  const executionFixture = await seedFixture(executionDb);
  const proposal = await proposeMetaAction(executionDb, { recommendationFingerprint: executionFixture.fingerprint, action: "pause_ad" }, { env: environment(), now: freshNow });
  await approveMetaAction(executionDb, proposal.action.id, { env: environment(), now: freshNow });
  await executionDb.syncRun.update({ where: { id: executionFixture.runId }, data: { finishedAt: new Date("2026-09-05T10:00:00.000Z") } });
  const provider = providerFor({ id: executionFixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(
    executeMetaAction(executionDb, proposal.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: provider.provider, now: staleNow }),
    (error) => error instanceof MetaActionError && error.code === "stale" && /evidence is stale/.test(error.message),
  );
  assert.equal(provider.calls.readAd, 0);
  assert.equal(provider.calls.updateAdStatus, 0);
  assert.equal((await executionDb.metaAction.findUnique({ where: { id: proposal.action.id } })).status, "FAILED");
});

test("stale durable metadata and live account/state mismatches fail closed without a write", async () => {
  const db = await createDatabase();
  const { fixture, result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  await db.syncRun.create({
    data: {
      id: "newer-run",
      accountId: ACCOUNT_ID,
      campaignId: null,
      trigger: "test",
      status: "SUCCEEDED",
      attributionKey: ATTRIBUTION_KEY,
      startedAt: new Date("2026-09-05T12:01:00.000Z"),
      finishedAt: new Date("2026-09-05T12:02:00.000Z"),
    },
  });
  const staleProvider = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: staleProvider.provider }), /not current|changed since/);
  assert.equal(staleProvider.calls.readAd, 0);
  assert.equal(staleProvider.calls.updateAdStatus, 0);
  assert.equal((await db.metaAction.findUnique({ where: { id: result.action.id } })).status, "FAILED");

  const db2 = await createDatabase();
  const prepared = await preparePause(db2);
  await approveMetaAction(db2, prepared.result.action.id, { env: environment() });
  const mismatch = providerFor({ id: prepared.fixture.targetId, accountId: "act-other-account", status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(executeMetaAction(db2, prepared.result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mismatch.provider }), /account or id/);
  assert.equal(mismatch.calls.updateAdStatus, 0);

  const db3 = await createDatabase();
  const liveChanged = await preparePause(db3);
  await approveMetaAction(db3, liveChanged.result.action.id, { env: environment() });
  const changedProvider = providerFor({ id: liveChanged.fixture.targetId, accountId: ACCOUNT_ID, status: "PAUSED", dailyBudgetMinor: null });
  await assert.rejects(executeMetaAction(db3, liveChanged.result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: changedProvider.provider }), /live Meta target differs/);
  assert.equal(changedProvider.calls.readAd, 1);
  assert.equal(changedProvider.calls.updateAdStatus, 0);
  assert.equal((await db3.metaAction.findUnique({ where: { id: liveChanged.result.action.id } })).status, "FAILED");
});

test("campaign-scoped actions bind both durable parent ownership and live Meta campaign identity", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db, { campaignId: "campaign-pr09" });
  const env = environment({ META_CAMPAIGN_ID: "campaign-pr09" });
  await db.ad.update({ where: { metaId: fixture.targetId }, data: { campaignMetaId: "campaign-other" } });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env }),
    /outside the configured campaign scope/,
  );
  await db.ad.update({ where: { metaId: fixture.targetId }, data: { campaignMetaId: "campaign-pr09" } });
  const proposal = await proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env });
  await approveMetaAction(db, proposal.action.id, { env });
  const provider = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null, campaignId: "campaign-other" });
  await assert.rejects(
    executeMetaAction(db, proposal.action.id, { env: environment({ ...env, META_WRITES_ENABLED: "true" }), provider: provider.provider }),
    /live Meta target differs/,
  );
  assert.equal(provider.calls.readAd, 1);
  assert.equal(provider.calls.updateAdStatus, 0);
  assert.equal((await db.metaAction.findUnique({ where: { id: proposal.action.id } })).status, "FAILED");
});

test("missing configured status is unknown even when effective status looks active", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db);
  await db.ad.update({ where: { metaId: fixture.targetId }, data: { configuredStatus: null, effectiveStatus: "ACTIVE" } });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env: environment() }),
    /target status is unknown/,
  );
  assert.equal(await db.metaAction.count(), 0);
});

test("execution revalidates stored budget bounds after approval", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db, { targetType: "adset", dailyBudgetMinor: 10_000, recommendationType: "scale_candidate" });
  const proposal = await proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "set_adset_daily_budget", dailyBudgetMinor: 12_000 }, { env: environment() });
  await approveMetaAction(db, proposal.action.id, { env: environment() });
  await db.metaAction.update({ where: { id: proposal.action.id }, data: { requestedChange: JSON.stringify({ dailyBudgetMinor: 13_000 }) } });
  const provider = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: 10_000 });
  await assert.rejects(executeMetaAction(db, proposal.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: provider.provider }), /outside the configured safety bounds/);
  assert.deepEqual(provider.calls, { readAd: 0, readAdSet: 0, updateAdStatus: 0, updateAdSetDailyBudget: 0 });
  assert.equal((await db.metaAction.findUnique({ where: { id: proposal.action.id } })).status, "FAILED");
});

test("provider failures and verification failures are terminal and never auto-retried", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  const failedProvider = providerFor({ id: "ad-pr09", accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null }, {
    updateAdStatus: async () => { throw new MetaActionProviderError("provider body contains token", { traceId: "trace-failed" }); },
  });
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: failedProvider.provider }), /uncertain/);
  const failed = await db.metaAction.findUnique({ where: { id: result.action.id } });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.error.includes("token"), false);
  assert.deepEqual(JSON.parse(failed.oldValue), { status: "ACTIVE" });
  assert.equal(failed.newValue, null);
  assert.equal(failed.metaObjectId, "ad-pr09");
  assert.equal(failed.metaTraceId, "trace-failed");
  const failedLog = await db.actionLog.findFirst({ where: { metaActionId: result.action.id } });
  assert.deepEqual(JSON.parse(failedLog.oldValue), { status: "ACTIVE" });
  assert.equal(failedLog.newValue, null);
  assert.match(failedLog.metaReference, /meta:ad-pr09 trace:trace-failed/);
  await assert.rejects(executeMetaAction(db, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: failedProvider.provider }), /cannot be retried/);
  assert.equal(failedProvider.calls.updateAdStatus, 1);

  const db2 = await createDatabase();
  const second = await preparePause(db2);
  await approveMetaAction(db2, second.result.action.id, { env: environment() });
  const verification = providerFor({ id: "ad-pr09", accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null }, {
    updateAdStatus: async (id) => ({ objectId: id, traceId: "trace-verify" }),
  });
  await assert.rejects(executeMetaAction(db2, second.result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: verification.provider }), /could not be verified/);
  assert.equal(verification.calls.updateAdStatus, 1);
  const verificationFailed = await db2.metaAction.findUnique({ where: { id: second.result.action.id } });
  assert.equal(verificationFailed.status, "FAILED");
  assert.deepEqual(JSON.parse(verificationFailed.oldValue), { status: "ACTIVE" });
  assert.equal(verificationFailed.metaObjectId, "ad-pr09");
  assert.equal(verificationFailed.metaTraceId, "trace-verify");
  const verificationLog = await db2.actionLog.findFirst({ where: { metaActionId: second.result.action.id } });
  assert.deepEqual(JSON.parse(verificationLog.oldValue), { status: "ACTIVE" });
  assert.equal(verificationLog.newValue, null);
  assert.match(verificationLog.metaReference, /meta:ad-pr09 trace:trace-verify/);
});

test("concurrent proposal and execution requests remain idempotent", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db);
  const proposals = await Promise.all([
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad", idempotencyKey: "operator-a" }, { env: environment() }),
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad", idempotencyKey: "operator-b" }, { env: environment() }),
  ]);
  assert.equal(await db.metaAction.count(), 1);
  assert.equal(new Set(proposals.map(({ action }) => action.id)).size, 1);
  await approveMetaAction(db, proposals[0].action.id, { env: environment() });
  const mocked = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null }, {
    readAd: async (id, current) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { ...current, id };
    },
  });
  const executions = await Promise.allSettled([
    executeMetaAction(db, proposals[0].action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider }),
    executeMetaAction(db, proposals[0].action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: mocked.provider }),
  ]);
  assert.equal(executions.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(executions.filter((item) => item.status === "rejected").length, 1);
  assert.equal(mocked.calls.updateAdStatus, 1);
  assert.equal(await db.actionLog.count(), 1);
  assert.equal((await db.metaAction.findUnique({ where: { id: proposals[0].action.id } })).status, "EXECUTED");
});

test("action scope is retained and checked for listing, proposal, approval and execution", async () => {
  const db = await createDatabase();
  const { fixture, result } = await preparePause(db);
  const differentScope = environment({ META_ATTRIBUTION_WINDOWS: "1d_click" });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env: differentScope }),
    /outside the currently configured Meta sync scope/,
  );
  assert.deepEqual(await readMetaActionViews(db, ACCOUNT_ID, { campaignId: null, attributionKey: "1d_click" }), []);
  await approveMetaAction(db, result.action.id, { env: environment() });
  const provider = providerFor({ id: fixture.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(
    executeMetaAction(db, result.action.id, { env: differentScope, provider: provider.provider }),
    /Meta action not found/,
  );
  assert.equal(provider.calls.readAd, 0);
  assert.equal((await db.metaAction.findUnique({ where: { id: result.action.id } })).status, "APPROVED");

  const otherAccount = environment({ META_AD_ACCOUNT_ID: "act_other-account" });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env: otherAccount }),
    /not available in this account scope/,
  );
  assert.deepEqual(await readMetaActionViews(db, "act_other-account", { campaignId: null, attributionKey: ATTRIBUTION_KEY }), []);
  await assert.rejects(
    approveMetaAction(db, result.action.id, { env: otherAccount }),
    /Meta action not found/,
  );

  const otherCampaign = environment({ META_CAMPAIGN_ID: "campaign-other" });
  await assert.rejects(
    proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env: otherCampaign }),
    /outside the currently configured Meta sync scope/,
  );
  assert.deepEqual(await readMetaActionViews(db, ACCOUNT_ID, { campaignId: "campaign-other", attributionKey: ATTRIBUTION_KEY }), []);
  await assert.rejects(
    approveMetaAction(db, result.action.id, { env: otherCampaign }),
    /Meta action not found/,
  );
});

test("a target lock prevents distinct recommendation actions from being approved concurrently", async () => {
  const db = await createDatabase();
  const fixture = await seedFixture(db);
  const recommendation = await db.recommendation.findUnique({ where: { fingerprint: fixture.fingerprint } });
  await db.recommendation.create({
    data: {
      ...recommendation,
      id: "duplicate-target-recommendation",
      fingerprint: `${fixture.fingerprint}|duplicate-target`,
    },
  });
  const first = await proposeMetaAction(db, { recommendationFingerprint: fixture.fingerprint, action: "pause_ad" }, { env: environment() });
  const second = await proposeMetaAction(db, { recommendationFingerprint: `${fixture.fingerprint}|duplicate-target`, action: "pause_ad", idempotencyKey: "second-target-action" }, { env: environment() });
  const approvals = await Promise.allSettled([
    approveMetaAction(db, first.action.id, { env: environment() }),
    approveMetaAction(db, second.action.id, { env: environment() }),
  ]);
  assert.equal(approvals.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(approvals.filter((item) => item.status === "rejected").length, 1);
  const firstRow = await db.metaAction.findUnique({ where: { id: first.action.id } });
  const secondRow = await db.metaAction.findUnique({ where: { id: second.action.id } });
  assert.equal([firstRow.status, secondRow.status].filter((status) => status === "APPROVED").length, 1);
  assert.equal([firstRow.status, secondRow.status].filter((status) => status === "PROPOSED").length, 1);
  const rejected = approvals.find((item) => item.status === "rejected");
  assert.match(rejected.reason.message, /already holds this target|Only a proposed/);
});

test("a final audit failure is recovered as a terminal, reference-bearing action without retrying Meta", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  let failedOnce = false;
  const flakyDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async (...args) => {
          if (!failedOnce) {
            failedOnce = true;
            throw new Error("simulated final audit outage");
          }
          return target.$transaction(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const provider = providerFor({ id: result.action.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(
    executeMetaAction(flakyDb, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: provider.provider }),
    /final audit persistence failed/,
  );
  const recovered = await db.metaAction.findUnique({ where: { id: result.action.id } });
  assert.equal(recovered.status, "FAILED");
  assert.deepEqual(JSON.parse(recovered.oldValue), { status: "ACTIVE" });
  assert.deepEqual(JSON.parse(recovered.newValue), { status: "PAUSED" });
  assert.equal(recovered.metaObjectId, result.action.targetId);
  assert.equal(recovered.metaTraceId, "trace-pr09");
  const log = await db.actionLog.findFirst({ where: { metaActionId: result.action.id } });
  assert.deepEqual(JSON.parse(log.newValue), { status: "PAUSED" });
  assert.match(log.metaReference, /meta:ad-pr09 trace:trace-pr09/);
  assert.equal(provider.calls.updateAdStatus, 1);
});

test("stale execution recovery releases locks even when the current read uses another scope", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  await db.metaAction.update({
    where: { id: result.action.id },
    data: { status: "EXECUTING", executingAt: new Date(Date.now() - 10 * 60 * 1_000) },
  });
  assert.deepEqual(await readMetaActionViews(db, ACCOUNT_ID, { campaignId: null, attributionKey: "1d_click" }), []);
  const recovered = await db.metaAction.findUnique({ where: { id: result.action.id } });
  assert.equal(recovered.status, "FAILED");
  assert.equal(recovered.targetLockKey, null);
  assert.equal(await db.actionLog.count(), 1);
});

test("if final-audit recovery also fails, the action stays non-retryable and Meta is still called once", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  let transactionCalls = 0;
  const unrecoverableDb = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async () => {
          transactionCalls += 1;
          throw new Error("simulated audit outage");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const provider = providerFor({ id: result.action.targetId, accountId: ACCOUNT_ID, status: "ACTIVE", dailyBudgetMinor: null });
  await assert.rejects(
    executeMetaAction(unrecoverableDb, result.action.id, { env: environment({ META_WRITES_ENABLED: "true" }), provider: provider.provider }),
    /final audit persistence could not be confirmed/,
  );
  const stranded = await db.metaAction.findUnique({ where: { id: result.action.id } });
  assert.equal(transactionCalls, 2);
  assert.equal(stranded.status, "EXECUTING");
  assert.equal(await db.actionLog.count(), 0);
  assert.equal(provider.calls.updateAdStatus, 1);
});

test("an interrupted execution is reaped as terminal on the next safe read", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  await db.metaAction.update({
    where: { id: result.action.id },
    data: { status: "EXECUTING", executingAt: new Date(Date.now() - 10 * 60 * 1_000) },
  });
  const views = await readMetaActionViews(db, ACCOUNT_ID, { campaignId: null, attributionKey: ATTRIBUTION_KEY });
  assert.equal(views[0].status, "FAILED");
  assert.match(views[0].error, /execution was interrupted/);
  assert.equal(await db.actionLog.count(), 1);
  assert.match((await db.actionLog.findFirst({ where: { metaActionId: result.action.id } })).result, /execution was interrupted/);
});

test("dashboard action reads expose only validated safe values", async () => {
  const db = await createDatabase();
  const { result } = await preparePause(db);
  const views = await readMetaActionViews(db, ACCOUNT_ID);
  assert.equal(views.length, 1);
  assert.equal(views[0].id, result.action.id);
  assert.equal(JSON.stringify(views).includes("META_MARKETING_TOKEN"), false);
  assert.equal(JSON.stringify(views).includes("test-token-that-must-never-be-stored"), false);
});

test("action-read database failures are surfaced instead of becoming an empty successful read", async () => {
  const db = await createDatabase();
  const broken = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "metaAction") return { findMany: async () => { throw new Error("database unavailable"); } };
      return Reflect.get(target, property, receiver);
    },
  });
  await assert.rejects(
    readMetaActionViews(broken, ACCOUNT_ID, { campaignId: null, attributionKey: ATTRIBUTION_KEY }),
    (error) => error instanceof MetaActionError && error.code === "verification" && /records could not be read/.test(error.message),
  );
});

test("enabled execution uses the private default provider with one form-encoded POST and read-after-write verification", async () => {
  const db = await createDatabase();
  const { fixture, result } = await preparePause(db);
  await approveMetaAction(db, result.action.id, { env: environment() });
  const calls = [];
  let reads = 0;
  const env = environment({ META_WRITES_ENABLED: "true" });
  const executed = await executeMetaAction(db, result.action.id, {
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (init.method === "POST") {
        return new Response(JSON.stringify({ id: fixture.targetId, success: true }), {
          status: 200,
          headers: { "content-type": "application/json", "x-fb-trace-id": "trace-private-provider" },
        });
      }
      reads += 1;
      return new Response(JSON.stringify({
        id: fixture.targetId,
        account_id: ACCOUNT_ID,
        status: reads === 1 ? "ACTIVE" : "PAUSED",
        effective_status: reads === 1 ? "ACTIVE" : "PAUSED",
        campaign_id: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(executed.action.status, "EXECUTED");
  assert.deepEqual(calls.map(({ init }) => init.method), ["GET", "POST", "GET"]);
  assert.match(calls[0].url, /https:\/\/graph\.facebook\.com\/v25\.0\/ad-pr09\?/);
  assert.match(calls[0].url, /fields=id%2Caccount_id%2Cstatus%2Ceffective_status%2Ccampaign_id/);
  assert.equal(calls[1].url, "https://graph.facebook.com/v25.0/ad-pr09");
  assert.equal(calls[1].init.body, "status=PAUSED");
  assert.equal(calls[1].url.includes("token"), false);
  assert.equal(calls[1].init.headers.Authorization, "Bearer test-token-that-must-never-be-stored");
  assert.equal(executed.action.metaTraceId, "trace-private-provider");
  assert.equal(await db.actionLog.count(), 1);

  const db2 = await createDatabase();
  const adSetFixture = await seedFixture(db2, { targetType: "adset", dailyBudgetMinor: 10_000, recommendationType: "scale_candidate" });
  const proposal = await proposeMetaAction(db2, { recommendationFingerprint: adSetFixture.fingerprint, action: "set_adset_daily_budget", dailyBudgetMinor: 12_000 }, { env });
  await approveMetaAction(db2, proposal.action.id, { env });
  const adSetCalls = [];
  let adSetReads = 0;
  const adSetExecuted = await executeMetaAction(db2, proposal.action.id, {
    env,
    fetchImpl: async (url, init) => {
      adSetCalls.push({ url, init });
      if (init.method === "POST") return new Response(JSON.stringify({ id: adSetFixture.targetId, success: true }), { status: 200, headers: { "x-fb-trace-id": "trace-adset-private" } });
      adSetReads += 1;
      return new Response(JSON.stringify({ id: adSetFixture.targetId, account_id: ACCOUNT_ID, status: "ACTIVE", effective_status: "ACTIVE", campaign_id: null, daily_budget: adSetReads === 1 ? "10000" : "12000" }), { status: 200 });
    },
  });
  assert.equal(adSetExecuted.action.status, "EXECUTED");
  assert.match(adSetCalls[0].url, /fields=.*daily_budget/);
  assert.equal(adSetCalls[1].init.body, "daily_budget=12000");
  assert.equal(adSetCalls.filter(({ init }) => init.method === "POST").length, 1);
});

test("the private default provider fails closed on Graph errors, malformed reads and network failures without retrying", async () => {
  const responses = [
    async () => new Response(JSON.stringify({ error: { message: "denied" } }), { status: 400, headers: { "x-fb-trace-id": "trace-denied" } }),
    async () => new Response("{}", { status: 200 }),
    async () => { throw new Error("network failure"); },
  ];
  for (const response of responses) {
    const db = await createDatabase();
    const { result } = await preparePause(db);
    await approveMetaAction(db, result.action.id, { env: environment() });
    const calls = [];
    await assert.rejects(
      executeMetaAction(db, result.action.id, {
        env: environment({ META_WRITES_ENABLED: "true" }),
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return response();
        },
      }),
      (error) => error instanceof MetaActionError && error.code === "provider",
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, "GET");
    assert.equal((await db.metaAction.findUnique({ where: { id: result.action.id } })).status, "FAILED");
  }
});
