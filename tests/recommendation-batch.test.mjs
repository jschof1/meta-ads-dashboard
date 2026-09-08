import test, { afterEach, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { createPrismaClient, withDatabaseClient } from "../lib/db.ts";
import { analyseRecommendations, metricsFromTotals } from "../lib/recommendations.ts";
import {
  parseRecommendationEvidence,
  persistRecommendationLifecycle,
  readActiveRecommendationViews,
} from "../lib/recommendation-store.ts";
import { RECOMMENDATION_RULE_VERSION } from "../lib/recommendation-types.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";

const fixtures = [];
const now = new Date("2026-09-06T12:00:00.123Z");
const later = (milliseconds) => new Date(now.getTime() + milliseconds);
const iso = (date) => date.toISOString().replace("Z", "+00:00");
const scope = {
  accountId: "act_batch-test",
  campaignId: null,
  attributionKey: "7d_click,1d_view",
  syncRunId: "first-run",
  now,
};
const metrics = metricsFromTotals({
  spendCents: 6000, impressions: 6000, reach: null, clicks: 120,
  linkClicks: 120, leads: 6, frequency: 1.5,
});
const base = analyseRecommendations({
  config: structuredClone(UKTL_CONFIG),
  target: { type: "ad", id: "template", name: "Synthetic creative" },
  comparisonDays: 7,
  current: metrics,
  previous: metrics,
  cumulative: metrics,
  status: "ACTIVE",
  learningState: null,
  series: ["2026-09-03", "2026-09-04", "2026-09-05"].map((date) => ({ date, metrics })),
  sampleSize: 3,
  daysActive: 14,
  budgetCents: null,
}).recommendations[0];

function candidate(id, overrides = {}) {
  return {
    ...structuredClone(base),
    key: `ad:${id}:${base.type}:7d:${RECOMMENDATION_RULE_VERSION}`,
    target: { type: "ad", id: String(id), name: `Synthetic creative ${id}` },
    ...overrides,
  };
}

function persist(db, recommendations, overrides = {}) {
  return persistRecommendationLifecycle(db, { ...scope, recommendations, ...overrides });
}

async function database() {
  const directory = await mkdtemp(join(tmpdir(), "recommendation-batch-"));
  const url = `file:${join(directory, "test.db")}`;
  const raw = createClient({ url });
  const db = createPrismaClient({ url });
  fixtures.push({ db, raw, directory });
  for (const migration of [
    "20260904210000_pr06_recommendation_engine",
    "20260905160000_pr10_production_hardening",
  ]) {
    await raw.executeMultiple(await readFile(new URL(
      `../prisma/migrations/${migration}/migration.sql`, import.meta.url,
    ), "utf8"));
  }
  return { db, raw, url };
}

async function storedRows(raw) {
  return (await raw.execute('SELECT * FROM "Recommendation" ORDER BY "fingerprint"')).rows;
}

function scopeId(overrides = {}) {
  const input = { ...scope, ruleVersion: RECOMMENDATION_RULE_VERSION, ...overrides };
  return JSON.stringify([input.accountId, input.campaignId, input.attributionKey, input.ruleVersion]);
}

async function storedState(raw) {
  return {
    recommendations: await storedRows(raw),
    scopes: (await raw.execute('SELECT * FROM "RecommendationScopeState" ORDER BY "id"')).rows,
  };
}

async function recordBatches(db) {
  // Use the writer's module entry: libSQL's ESM and CJS clients have separate
  // prototypes under tsx, so spying on the fixture connection misses writes.
  const prototype = await withDatabaseClient(db, async (client) => Object.getPrototypeOf(client));
  const nativeBatch = prototype.batch;
  const calls = [];
  mock.method(prototype, "transaction", () => assert.fail("Native interactive transactions must not be used"));
  mock.method(prototype, "batch", function (statements, mode) {
    calls.push({ statements, mode, client: this });
    return nativeBatch.call(this, statements, mode);
  });
  return () => {
    assert.equal(calls.length, 1, "one native batch for the entire lifecycle operation");
    const [call] = calls.splice(0);
    assert.equal(call.mode, "write");
    assert.equal(call.client.closed, true);
    assert.match(call.statements[0].sql, /^INSERT INTO "RecommendationScopeState"/);
    for (const statement of call.statements) {
      assert.ok((statement.args?.length ?? 0) <= 32, "statement parameter count must stay bounded");
    }
  };
}

beforeEach(() => {
  mock.method(globalThis, "fetch", () => assert.fail("recommendation fixtures must never call a provider"));
});

afterEach(async () => {
  mock.restoreAll();
  while (fixtures.length > 0) {
    const { db, raw, directory } = fixtures.pop();
    await db.$disconnect();
    raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("2,000 candidates create, repeat with duplicate keys, and resolve in one bounded native batch each", async () => {
  const { db } = await database();
  const checkBatch = await recordBatches(db);
  const candidates = Array.from({ length: 2_000 }, (_, index) => candidate(index));
  assert.deepEqual(await persist(db, candidates), { created: 2_000, updated: 0, resolved: 0, active: 2_000 });
  checkBatch();
  const first = await db.recommendation.findMany();
  const identities = new Map(first.map((row) => [row.fingerprint, row.id]));
  assert.equal(identities.size, 2_000);
  assert.equal(new Set(first.map((row) => row.id)).size, 2_000);

  const duplicate = candidate(1_999, { reason: "The last occurrence wins" });
  assert.deepEqual(await persist(db, [...candidates, duplicate, duplicate], { now: later(1_000), syncRunId: "repeat-run" }), {
    created: 0, updated: 2_000, resolved: 0, active: 2_000,
  });
  checkBatch();
  const repeated = await db.recommendation.findMany();
  assert.equal(repeated.length, 2_000);
  for (const row of repeated) {
    assert.equal(row.id, identities.get(row.fingerprint));
    assert.deepEqual(row.firstSeenAt, now);
    assert.deepEqual(row.lastSeenAt, later(1_000));
    assert.equal(row.sourceSyncRunId, "repeat-run");
    assert.equal(row.lifecycle, "OPEN");
  }
  assert.equal(repeated.find((row) => row.targetId === "1999").reason, duplicate.reason);
  assert.equal((await readActiveRecommendationViews(db, scope)).length, 2_000);

  assert.deepEqual(await persist(db, [], { now: later(2_000), syncRunId: "resolve-run" }), {
    created: 0, updated: 0, resolved: 2_000, active: 0,
  });
  checkBatch();
  const resolved = await db.recommendation.findMany();
  assert.equal(resolved.length, 2_000);
  for (const row of resolved) {
    assert.equal(row.id, identities.get(row.fingerprint));
    assert.equal(row.lifecycle, "RESOLVED");
    assert.deepEqual(row.resolvedAt, later(2_000));
    assert.deepEqual(row.firstSeenAt, now);
    assert.deepEqual(row.lastSeenAt, later(1_000));
  }
  assert.deepEqual(await persist(db, [], { now: later(3_000) }), { created: 0, updated: 0, resolved: 0, active: 0 });
  checkBatch();
});

test("large overlapping sets report exact creates, updates and resolutions without expanding IN lists", async () => {
  const { db } = await database();
  await persist(db, Array.from({ length: 2_000 }, (_, index) => candidate(index)));
  const checkBatch = await recordBatches(db);
  const next = Array.from({ length: 2_000 }, (_, index) => candidate(index + 1_000));
  assert.deepEqual(await persist(db, next, { now: later(1_000) }), {
    created: 1_000, updated: 1_000, resolved: 1_000, active: 2_000,
  });
  checkBatch();
  assert.equal(await db.recommendation.count({ where: { lifecycle: "OPEN" } }), 2_000);
  assert.equal(await db.recommendation.count({ where: { lifecycle: "RESOLVED" } }), 1_000);
});

test("conflicts preserve historical identity and firstSeenAt while updating fields and canonical evidence", async () => {
  const { db, raw } = await database();
  const original = candidate("legacy");
  await persist(db, [original]);
  await raw.execute({
    sql: 'UPDATE "Recommendation" SET "id" = ?, "firstSeenAt" = ?, "createdAt" = ?',
    args: ["historical-cuid", later(-5_000).getTime(), iso(later(-4_000))],
  });
  const evidence = { ...original.evidence, notes: ["access_token=synthetic-only", "Revised evidence"], sampleSize: 4 };
  const revised = candidate("legacy", {
    target: { type: "ad", id: "legacy", name: "Renamed creative" },
    type: "monitor", severity: "watch", confidence: "low",
    reason: "Updated reason", proposedAction: "Check the matched evidence", evidence,
  });
  assert.deepEqual(await persist(db, [revised], { now: later(1_000), syncRunId: "revised-run" }), {
    created: 0, updated: 1, resolved: 0, active: 1,
  });
  const [row] = await db.recommendation.findMany();
  assert.equal(row.id, "historical-cuid");
  assert.deepEqual(row.firstSeenAt, later(-5_000));
  assert.deepEqual(row.createdAt, later(-4_000));
  assert.deepEqual(row.lastSeenAt, later(1_000));
  assert.equal(row.sourceSyncRunId, "revised-run");
  for (const field of ["type", "severity", "confidence", "reason", "proposedAction"]) assert.equal(row[field], revised[field]);
  assert.equal(row.targetName, revised.target.name);
  assert.equal(row.ruleVersion, RECOMMENDATION_RULE_VERSION);
  assert.equal(row.analysisWindowDays, 7);
  assert.deepEqual(parseRecommendationEvidence(row.evidence).notes, ["access_token=[REDACTED]", "Revised evidence"]);
  assert.equal((await storedRows(raw))[0].lastSeenAt, iso(later(1_000)));

  const reversedEvidence = Object.fromEntries(Object.entries(evidence).reverse());
  assert.deepEqual(await persist(db, [{ ...revised, evidence: reversedEvidence }], { now: later(1_000), syncRunId: "revised-run" }), {
    created: 0, updated: 1, resolved: 0, active: 1,
  });
  assert.equal((await db.recommendation.findFirst()).evidence, row.evidence);
  await persist(db, [], { now: later(2_000) });
  assert.deepEqual(await persist(db, [revised], { now: later(3_000) }), { created: 0, updated: 1, resolved: 0, active: 1 });
  const reopened = await db.recommendation.findFirst();
  assert.equal(reopened.id, row.id);
  assert.deepEqual(reopened.firstSeenAt, row.firstSeenAt);
  assert.deepEqual(reopened.createdAt, row.createdAt);
  assert.deepEqual(reopened.lastSeenAt, later(3_000));
  assert.equal(reopened.lifecycle, "OPEN");
  assert.equal(reopened.resolvedAt, null);
});

test("reconciliation is confined to the exact account, nullable campaign, attribution and rule version", async () => {
  const { db, raw } = await database();
  const cases = [
    ["current", {}],
    ["other-account", { accountId: "act_other" }],
    ["other-campaign", { campaignId: "campaign-1" }],
    ["empty-campaign", { campaignId: "" }],
    ["other-attribution", { attributionKey: "1d_click" }],
    ["legacy-rule", {}],
    ["future-rule", {}],
  ];
  for (const [id, overrides] of cases) await persist(db, [candidate(id)], { ...overrides, reconcile: false });
  for (const [id, rule] of [["legacy-rule", "pr06.v0"], ["future-rule", "pr06.v2"]]) {
    await raw.execute({ sql: 'UPDATE "Recommendation" SET "ruleVersion" = ? WHERE "targetId" = ?', args: [rule, id] });
  }
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, [], { now: later(1_000) }), { created: 0, updated: 0, resolved: 1, active: 0 });
  const after = await storedRows(raw);
  for (const row of after) {
    if (row.targetId === "current") assert.equal(row.lifecycle, "RESOLVED");
    else assert.deepEqual(row, before.find((prior) => prior.id === row.id));
  }
  assert.deepEqual(await persist(db, [], { campaignId: "", now: later(2_000) }), { created: 0, updated: 0, resolved: 1, active: 0 });
  assert.equal((await db.recommendation.findFirst({ where: { targetId: "other-campaign" } })).lifecycle, "OPEN");
});

test("partial observations update and reopen incoming rows without resolving omissions; active means incoming unique keys", async () => {
  const { db, raw } = await database();
  const first = candidate("first");
  const second = candidate("second");
  await persist(db, [first, second]);
  await persist(db, [first], { now: later(1_000) });
  assert.deepEqual(await persist(db, [second, second], { now: later(2_000), reconcile: false }), {
    created: 0, updated: 1, resolved: 0, active: 1,
  });
  assert.equal(await db.recommendation.count({ where: { lifecycle: "OPEN" } }), 2);
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, [], { now: later(3_000), reconcile: false }), { created: 0, updated: 0, resolved: 0, active: 0 });
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, [candidate("third")], { now: later(4_000), reconcile: false }), {
    created: 1, updated: 0, resolved: 0, active: 1,
  });
  assert.equal(await db.recommendation.count({ where: { lifecycle: "OPEN" } }), 3);
});

const encodings = [
  ["numeric epoch milliseconds", (date) => date.getTime()],
  ["ISO Z", (date) => date.toISOString()],
  ["Prisma ISO UTC offset", iso],
  ["ISO positive offset", (date) => new Date(date.getTime() + 3_600_000).toISOString().replace("Z", "+01:00")],
  ["ISO negative offset", (date) => new Date(date.getTime() - 14_400_000).toISOString().replace("Z", "-04:00")],
  ["SQLite timestamp", (date) => date.toISOString().replace("T", " ").replace("Z", "")],
];

test("mixed numeric and ISO dates protect newer observations and accept exact millisecond ties", async () => {
  const { db, raw } = await database();
  const candidates = encodings.map(([label]) => candidate(label));
  await persist(db, candidates);
  for (const [label, encode] of encodings) {
    await raw.execute({ sql: 'UPDATE "Recommendation" SET "lastSeenAt" = ? WHERE "targetId" = ?', args: [encode(now), label] });
  }
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, candidates.map((item) => ({ ...item, reason: "One millisecond too old" })), {
    now: later(-1), syncRunId: "older-run",
  }), { created: 0, updated: 0, resolved: 0, active: encodings.length });
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, [], { now: later(-1) }), { created: 0, updated: 0, resolved: 0, active: 0 });
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, candidates), {
    created: 0, updated: encodings.length, resolved: 0, active: encodings.length,
  });
  for (const row of await storedRows(raw)) assert.equal(row.lastSeenAt, iso(now));

  for (const [label, encode] of encodings) {
    await raw.execute({ sql: 'UPDATE "Recommendation" SET "lastSeenAt" = ? WHERE "targetId" = ?', args: [encode(now), label] });
  }
  assert.deepEqual(await persist(db, []), { created: 0, updated: 0, resolved: encodings.length, active: 0 });
  for (const row of await db.recommendation.findMany()) {
    assert.deepEqual(row.lastSeenAt, now);
    assert.deepEqual(row.resolvedAt, now);
  }
});

test("REAL epoch timestamps compare numerically without truncating a newer fractional millisecond", async () => {
  const { db, raw } = await database();
  const item = candidate("fractional");
  await persist(db, [item]);
  await raw.execute({ sql: 'UPDATE "Recommendation" SET "lastSeenAt" = ?', args: [now.getTime() + 0.25] });
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, [item]), { created: 0, updated: 0, resolved: 0, active: 1 });
  assert.deepEqual(await persist(db, []), { created: 0, updated: 0, resolved: 0, active: 0 });
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, [item], { now: later(1) }), { created: 0, updated: 1, resolved: 0, active: 1 });
});

test("an older candidate cannot reopen a newer resolution in any stored timestamp encoding", async () => {
  const { db, raw } = await database();
  const candidates = encodings.map(([label]) => candidate(label));
  await persist(db, candidates);
  await persist(db, [], { now: later(2_000) });
  for (const [label, encode] of encodings) {
    await raw.execute({
      sql: 'UPDATE "Recommendation" SET "lastSeenAt" = ?, "resolvedAt" = ? WHERE "targetId" = ?',
      args: [encode(now), encode(later(2_000)), label],
    });
  }
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, candidates, { now: later(1_999), syncRunId: "late-run" }), {
    created: 0, updated: 0, resolved: 0, active: encodings.length,
  });
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, candidates, { now: later(2_000) }), {
    created: 0, updated: encodings.length, resolved: 0, active: encodings.length,
  });
  for (const row of await db.recommendation.findMany()) {
    assert.equal(row.lifecycle, "OPEN");
    assert.equal(row.resolvedAt, null);
    assert.deepEqual(row.firstSeenAt, now);
    assert.deepEqual(row.lastSeenAt, later(2_000));
  }
});

for (const [label, concurrentAt, concurrentRun, accepted] of [
  ["newer observation", later(1), "concurrent-run", false],
  ["equal time, different run", now, "concurrent-run", false],
  ["equal time, same run", now, scope.syncRunId, true],
]) {
  test(`conflict arriving before batch execution is counted atomically (${label})`, async () => {
    const { db, raw, url } = await database();
    const other = createPrismaClient({ url });
    const prototype = await withDatabaseClient(db, async (client) => Object.getPrototypeOf(client));
    const nativeBatch = prototype.batch;
    let pending = true;
    let concurrentResult;
    let concurrentState;
    mock.method(prototype, "batch", async function (statements, mode) {
      if (pending) {
        pending = false;
        concurrentResult = await persist(other, [candidate("shared", { reason: "Concurrent observation" }), candidate("omitted")], {
          now: concurrentAt, syncRunId: concurrentRun,
        });
        concurrentState = await storedState(raw);
      }
      return nativeBatch.call(this, statements, mode);
    });
    try {
      const result = await persist(db, [candidate("shared", { reason: "Pending observation" })]);
      assert.deepEqual(concurrentResult, { created: 2, updated: 0, resolved: 0, active: 2 });
      assert.deepEqual(result, {
        created: 0, updated: accepted ? 1 : 0, resolved: accepted ? 1 : 0, active: 1,
      });
      const after = await storedRows(raw);
      for (const row of after) assert.equal(row.id, concurrentState.recommendations.find((prior) => prior.fingerprint === row.fingerprint).id);
      if (!accepted) assert.deepEqual(await storedState(raw), concurrentState);
      else assert.equal(after.find((row) => row.targetId === "shared").reason, "Pending observation");
    } finally {
      await other.$disconnect();
    }
  });
}

test("invalid evidence at the end of 2,000 candidates leaves all persisted rows and resolutions untouched", async () => {
  const { db, raw } = await database();
  const existing = candidate("existing");
  await persist(db, [existing, candidate("would-resolve")]);
  const before = await storedState(raw);
  const invalid = candidate("invalid", { evidence: { ...base.evidence, confidenceScore: 101 } });
  const candidates = [existing, ...Array.from({ length: 1_998 }, (_, index) => candidate(index)), invalid];
  await assert.rejects(persist(db, candidates, { now: later(1_000) }), /Recommendation evidence failed validation/);
  assert.deepEqual(await storedState(raw), before);
});

test("duplicate keys are deduplicated before evidence validation and only the last occurrence is persisted", async () => {
  const { db, raw } = await database();
  const valid = candidate("duplicate");
  const invalid = { ...valid, evidence: {} };
  assert.deepEqual(await persist(db, [invalid, valid]), { created: 1, updated: 0, resolved: 0, active: 1 });
  const before = await storedRows(raw);
  await assert.rejects(persist(db, [valid, invalid], { now: later(1_000) }), /evidence failed validation/);
  assert.deepEqual(await storedRows(raw), before);
});

test("a midbatch database failure rolls back creations, updates, reopenings and reconciliation together", async () => {
  const { db, raw } = await database();
  const existing = candidate("existing");
  const reopened = candidate("reopened");
  const omitted = candidate("would-resolve");
  await persist(db, [existing, reopened, omitted]);
  await persist(db, [existing, omitted], { now: later(1_000) });
  const before = await storedState(raw);
  await raw.execute(`CREATE TRIGGER fail_middle BEFORE INSERT ON "Recommendation"
    WHEN NEW."targetId" = '1000' BEGIN SELECT RAISE(ABORT, 'synthetic midbatch failure'); END`);
  const candidates = [
    { ...existing, reason: "This update must roll back" }, reopened,
    ...Array.from({ length: 2_000 }, (_, index) => candidate(index)),
  ];
  await assert.rejects(persist(db, candidates, { now: later(2_000) }), /synthetic midbatch failure/);
  assert.deepEqual(await storedState(raw), before);
  await raw.execute("DROP TRIGGER fail_middle");
  assert.deepEqual(await persist(db, candidates, { now: later(2_000) }), {
    created: 2_000, updated: 2, resolved: 1, active: 2_002,
  });
  assert.equal((await storedState(raw)).scopes[0].observedAt, iso(later(2_000)));
});

test("a newer pause observation prevents an older unseen scale key from entering the scope", async () => {
  const { db, raw, url } = await database();
  const pause = candidate("same-ad", { key: "same-ad:pause", type: "pause_candidate" });
  const scale = candidate("same-ad", { key: "same-ad:scale", type: "scale_candidate" });
  await persist(db, [pause], { now: later(3_000), syncRunId: "T3" });
  const before = await storedState(raw);
  // Another Prisma client models a later request/process with no local state.
  const other = createPrismaClient({ url });
  try {
    assert.deepEqual(await persist(other, [scale, scale], { now: later(2_000), syncRunId: "T2" }), {
      created: 0, updated: 0, resolved: 0, active: 1,
    });
  } finally {
    await other.$disconnect();
  }
  assert.deepEqual(await storedState(raw), before);
  assert.equal(before.recommendations.length, 1);
  assert.equal(before.recommendations[0].type, "pause_candidate");
  assert.equal(before.scopes[0].id, scopeId());
  assert.equal(before.scopes[0].observedAt, iso(later(3_000)));
  assert.equal(before.scopes[0].sourceSyncRunId, "T3");
});

test("repeated empty observations advance the scope watermark even when no row is resolved", async () => {
  const { db, raw } = await database();
  const item = candidate("reopen");
  await persist(db, [item], { now: later(1_000), syncRunId: "T1" });
  assert.deepEqual(await persist(db, [], { now: later(2_000), syncRunId: "T2" }), {
    created: 0, updated: 0, resolved: 1, active: 0,
  });
  assert.deepEqual(await persist(db, [], { now: later(4_000), syncRunId: "T4" }), {
    created: 0, updated: 0, resolved: 0, active: 0,
  });
  const before = await storedState(raw);
  assert.equal(before.scopes[0].observedAt, iso(later(4_000)));
  assert.equal(before.scopes[0].sourceSyncRunId, "T4");
  assert.deepEqual(await persist(db, [item], { now: later(3_000), syncRunId: "T3" }), {
    created: 0, updated: 0, resolved: 0, active: 1,
  });
  assert.deepEqual(await storedState(raw), before);
});

test("an empty first observation blocks older unseen candidates and older empty observations", async () => {
  const { db, raw } = await database();
  await persist(db, [], { now: later(4_000), syncRunId: "empty-first" });
  const before = await storedState(raw);
  assert.equal(before.recommendations.length, 0);
  assert.equal(before.scopes.length, 1);
  assert.deepEqual(await persist(db, [candidate("unseen")], { now: later(3_000), syncRunId: "older-unseen" }), {
    created: 0, updated: 0, resolved: 0, active: 1,
  });
  assert.deepEqual(await persist(db, [], { now: later(2_000), syncRunId: "older-empty" }), {
    created: 0, updated: 0, resolved: 0, active: 0,
  });
  assert.deepEqual(await storedState(raw), before);
});

test("equal timestamps reject a different source run for inserts, updates and reconciliation", async () => {
  const { db, raw } = await database();
  const retained = candidate("retained");
  await persist(db, [retained, candidate("omitted")], { syncRunId: "winner" });
  const before = await storedState(raw);
  const conflicting = [{ ...retained, reason: "Losing update" }, candidate("unseen")];
  for (const reconcile of [true, false]) {
    assert.deepEqual(await persist(db, conflicting, { syncRunId: "loser", reconcile }), {
      created: 0, updated: 0, resolved: 0, active: 2,
    });
    assert.deepEqual(await persist(db, [], { syncRunId: "loser", reconcile }), {
      created: 0, updated: 0, resolved: 0, active: 0,
    });
    assert.deepEqual(await storedState(raw), before);
  }
  assert.deepEqual(await persist(db, [retained, candidate("omitted")], { syncRunId: "winner" }), {
    created: 0, updated: 2, resolved: 0, active: 2,
  });
  assert.deepEqual(await persist(db, [retained], { now: later(1), syncRunId: "later-winner" }), {
    created: 0, updated: 1, resolved: 1, active: 1,
  });
});

test("partial observations advance the watermark, retain omitted rows and fence older complete or partial sets", async () => {
  const { db, raw } = await database();
  const older = candidate("older");
  const current = candidate("current");
  await persist(db, [older], { syncRunId: "T1" });
  await persist(db, [current], { now: later(2_000), syncRunId: "T3", reconcile: false });
  const before = await storedState(raw);
  assert.equal(before.recommendations.filter((row) => row.lifecycle === "OPEN").length, 2);
  for (const reconcile of [true, false]) {
    assert.deepEqual(await persist(db, [older, candidate("unseen")], { now: later(1_000), syncRunId: "T2", reconcile }), {
      created: 0, updated: 0, resolved: 0, active: 2,
    });
    assert.deepEqual(await storedState(raw), before);
  }
  await persist(db, [], { now: later(4_000), syncRunId: "T5", reconcile: false });
  const emptyPartial = await storedState(raw);
  assert.deepEqual(emptyPartial.recommendations, before.recommendations);
  assert.equal(emptyPartial.scopes[0].observedAt, iso(later(4_000)));
  assert.deepEqual(await persist(db, [], { now: later(3_000), syncRunId: "T4" }), {
    created: 0, updated: 0, resolved: 0, active: 0,
  });
  assert.deepEqual(await storedState(raw), emptyPartial);
});

test("scope watermark keys distinguish accounts, nullable campaigns, attribution, rule versions and delimiters", async () => {
  const { db, raw } = await database();
  const scopes = [
    {}, { accountId: "other" }, { campaignId: "" }, { campaignId: "account" }, { campaignId: "campaign-1" },
    { attributionKey: "1d_click" }, { accountId: "a|b", attributionKey: "c" }, { accountId: "a", attributionKey: "b|c" },
  ];
  await persist(db, [], { now: later(5_000), syncRunId: "newest" });
  for (const other of scopes.slice(1)) await persist(db, [], { ...other, syncRunId: "independent" });
  const rules = ["pr06.v0", "pr06.v2"];
  for (const ruleVersion of rules) {
    await raw.execute({
      sql: `INSERT INTO "RecommendationScopeState"
        ("id", "accountId", "campaignId", "attributionKey", "ruleVersion", "observedAt", "sourceSyncRunId", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [scopeId({ ruleVersion }), scope.accountId, scope.campaignId, scope.attributionKey,
        ruleVersion, iso(later(10_000)), "other-rule", iso(now)],
    });
  }
  const before = await storedState(raw);
  assert.equal(before.scopes.length, scopes.length + rules.length);
  assert.deepEqual(new Set(before.scopes.map((row) => row.id)), new Set([
    ...scopes.map((item) => scopeId(item)), ...rules.map((ruleVersion) => scopeId({ ruleVersion })),
  ]));
  assert.deepEqual(await persist(db, [candidate("current-rule")], { now: later(6_000), syncRunId: "current-rule-run" }), {
    created: 1, updated: 0, resolved: 0, active: 1,
  });
  for (const row of (await storedState(raw)).scopes.filter((row) => row.id !== scopeId())) {
    assert.deepEqual(row, before.scopes.find((prior) => prior.id === row.id));
  }
});

test("scope watermark normalization handles numeric and ISO dates, source ties and millisecond boundaries", async () => {
  const { db, raw } = await database();
  for (const [label, encode] of encodings) {
    const overrides = { campaignId: label, syncRunId: "stored-run" };
    await persist(db, [], overrides);
    await raw.execute({
      sql: 'UPDATE "RecommendationScopeState" SET "observedAt" = ? WHERE "id" = ?',
      args: [encode(now), scopeId(overrides)],
    });
  }
  const before = await storedState(raw);
  for (const [label] of encodings) {
    for (const [timestamp, syncRunId] of [[later(-1), "stored-run"], [now, "different-run"]]) {
      assert.deepEqual(await persist(db, [candidate(label)], { campaignId: label, now: timestamp, syncRunId }), {
        created: 0, updated: 0, resolved: 0, active: 1,
      });
    }
  }
  assert.deepEqual(await storedState(raw), before);
  for (const [label] of encodings) {
    assert.deepEqual(await persist(db, [candidate(label)], { campaignId: label, syncRunId: "stored-run" }), {
      created: 1, updated: 0, resolved: 0, active: 1,
    });
    assert.deepEqual(await persist(db, [], { campaignId: label, now: later(1), syncRunId: "newer-run" }), {
      created: 0, updated: 0, resolved: 1, active: 0,
    });
  }
  for (const row of (await storedState(raw)).scopes) assert.equal(row.observedAt, iso(later(1)));
});

test("before the first watermark, newer legacy lastSeenAt or resolvedAt fences unseen older keys in every date encoding", async () => {
  const { db, raw } = await database();
  const cases = [];
  for (const column of ["lastSeenAt", "resolvedAt"]) {
    for (const [label, encode] of encodings) {
      const campaignId = `${column}:${label}`;
      await persist(db, [candidate("legacy")], { campaignId, now: later(1_000), syncRunId: "legacy-source" });
      await raw.execute({
        sql: `UPDATE "Recommendation" SET "${column}" = ?, "lifecycle" = ? WHERE "campaignId" = ?`,
        args: [encode(later(5_000)), column === "resolvedAt" ? "RESOLVED" : "OPEN", campaignId],
      });
      cases.push(campaignId);
    }
  }
  // Simulate migrated historical rows, which have no durable scope watermark.
  await raw.execute('DELETE FROM "RecommendationScopeState"');
  const before = await storedState(raw);
  for (const campaignId of cases) {
    assert.deepEqual(await persist(db, [candidate("unseen")], { campaignId, now: later(4_000), syncRunId: "older" }), {
      created: 0, updated: 0, resolved: 0, active: 1,
    });
    assert.deepEqual(await persist(db, [], { campaignId, now: later(4_000), syncRunId: "older-empty" }), {
      created: 0, updated: 0, resolved: 0, active: 0,
    });
  }
  assert.deepEqual(await storedState(raw), before);
  for (const campaignId of cases) {
    assert.deepEqual(await persist(db, [candidate("legacy")], { campaignId, now: later(6_000), syncRunId: "newer" }), {
      created: 0, updated: 1, resolved: 0, active: 1,
    });
  }
  const after = await storedState(raw);
  assert.equal(after.scopes.length, cases.length);
  for (const row of after.recommendations) {
    assert.equal(row.id, before.recommendations.find((prior) => prior.fingerprint === row.fingerprint).id);
    assert.equal(row.lifecycle, "OPEN");
  }
});

test("legacy bootstrap ignores newer recommendation rows belonging to another exact scope or rule version", async () => {
  const { db, raw } = await database();
  for (const [id, overrides] of [
    ["other-account", { accountId: "other-account" }],
    ["other-campaign", { campaignId: "campaign-1" }],
    ["other-attribution", { attributionKey: "other-attribution" }],
    ["other-rule", {}],
  ]) {
    await persist(db, [candidate(id)], { ...overrides, now: later(5_000), reconcile: false });
  }
  await raw.execute(`UPDATE "Recommendation" SET "ruleVersion" = 'pr06.v2' WHERE "targetId" = 'other-rule'`);
  await raw.execute('DELETE FROM "RecommendationScopeState"');
  const before = await storedRows(raw);
  assert.deepEqual(await persist(db, [candidate("current")]), { created: 1, updated: 0, resolved: 0, active: 1 });
  for (const row of (await storedRows(raw)).filter((row) => row.targetId !== "current")) {
    assert.deepEqual(row, before.find((prior) => prior.id === row.id));
  }
});

test("a failed first observation rolls back the new watermark so another run at that time can succeed", async () => {
  const { db, raw } = await database();
  await raw.execute(`CREATE TRIGGER fail_first BEFORE INSERT ON "Recommendation"
    BEGIN SELECT RAISE(ABORT, 'synthetic first observation failure'); END`);
  await assert.rejects(persist(db, [candidate("first")], { syncRunId: "failed-run" }), /synthetic first observation failure/);
  assert.deepEqual(await storedState(raw), { recommendations: [], scopes: [] });
  await raw.execute("DROP TRIGGER fail_first");
  assert.deepEqual(await persist(db, [candidate("retry")], { syncRunId: "retry-run" }), {
    created: 1, updated: 0, resolved: 0, active: 1,
  });
  assert.equal((await storedState(raw)).scopes[0].sourceSyncRunId, "retry-run");
});

test("quoted keys and nullable scopes remain bound data, and invalid observation dates never write", async () => {
  const { db, raw } = await database();
  const item = candidate("quotes-'\"?\\|", { reason: "Quoted ' and \" values remain data" });
  const overrides = { accountId: "act_'?", campaignId: "campaign_'\"", attributionKey: "7d_'click" };
  assert.deepEqual(await persist(db, [item], overrides), { created: 1, updated: 0, resolved: 0, active: 1 });
  assert.deepEqual(await persist(db, [item], overrides), { created: 0, updated: 1, resolved: 0, active: 1 });
  const before = await storedRows(raw);
  assert.equal(before[0].reason, item.reason);
  await assert.rejects(persist(db, [], { ...overrides, now: new Date(NaN) }), /Invalid recommendation observation date/);
  assert.deepEqual(await storedRows(raw), before);
  assert.deepEqual(await persist(db, [], { ...overrides, now: later(1_000) }), { created: 0, updated: 0, resolved: 1, active: 0 });
});
