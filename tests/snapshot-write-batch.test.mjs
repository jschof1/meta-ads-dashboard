import test, { afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { createPrismaClient, withDatabaseClient } from "../lib/db.ts";
import { SnapshotWriteBatch } from "../lib/snapshot-write-batch.ts";
import { readCommittedMigrations, splitSqlStatements } from "../scripts/turso-schema.mjs";

const fixtures = [];
const now = new Date("2026-09-06T12:00:00.123Z");

async function database() {
  const directory = await mkdtemp(join(tmpdir(), "snapshot-write-batch-"));
  const url = `file:${join(directory, "test.db")}`;
  const raw = createClient({ url });
  const db = createPrismaClient({ url });
  fixtures.push({ db, raw, directory });
  for (const migration of await readCommittedMigrations(new URL("../prisma/migrations", import.meta.url).pathname)) {
    await raw.batch(splitSqlStatements(migration.sql), "write");
  }
  return { db, raw, url };
}

async function lease(db, table = "SyncRun", overrides = {}) {
  const common = { status: "RUNNING", trigger: "manual", lockKey: `scope-${table}`, lockOwner: "owner", lockExpiresAt: new Date(now.getTime() + 60_000) };
  const run = table === "SyncRun"
    ? await db.syncRun.create({ data: { ...common, accountId: "act_test", attributionKey: "7d_click" } })
    : await db.crmSyncRun.create({ data: { ...common, locationId: "location", pipelineId: "pipeline", apiVersion: "v3", mappingHash: "mapping" } });
  return { table, id: run.id, owner: run.lockOwner, lockKey: run.lockKey, completedAt: now, leaseNow: now, data: { error: null }, lostLeaseError: new Error("test lease lost"), ...overrides };
}

function campaign(batch, metaId, fields = {}, update = { name: "Updated" }) {
  batch.upsert("Campaign", { create: { metaId, name: metaId, ...fields }, update });
}

afterEach(async () => {
  mock.restoreAll();
  while (fixtures.length) {
    const { db, raw, directory } = fixtures.pop();
    await db.$disconnect();
    raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves identity, field omissions, nulls, empty updates and Prisma DateTime encoding", async () => {
  const { db, raw } = await database();
  const guard = await lease(db);
  const before = await db.campaign.create({ data: { id: "existing-cuid", metaId: "existing", name: "Historical", objective: "LEADS", providerUpdatedAt: now, raw: "historical", createdAt: now, updatedAt: now } });
  const timestamp = new Date(now.getTime() + 2_000);
  const batch = new SnapshotWriteBatch(timestamp);
  campaign(batch, "existing", {}, { name: undefined, objective: null, providerUpdatedAt: undefined });
  campaign(batch, "new", { id: "explicit-id", providerUpdatedAt: now });
  await batch.commit(db, guard);
  const after = await db.campaign.findUnique({ where: { metaId: "existing" } });
  assert.equal(after.id, before.id);
  assert.equal(after.name, "Historical");
  assert.equal(after.raw, "historical");
  assert.equal(after.objective, null);
  assert.deepEqual(after.providerUpdatedAt, now);
  assert.deepEqual(after.createdAt, before.createdAt);
  assert.deepEqual(after.updatedAt, timestamp);
  const created = await db.campaign.findUnique({ where: { metaId: "new" } });
  assert.equal(created.id, "explicit-id");
  assert.deepEqual(created.createdAt, timestamp);
  assert.deepEqual(created.updatedAt, timestamp);
  const encoding = await raw.execute('SELECT "providerUpdatedAt" FROM "Campaign" WHERE "metaId" = \'new\'');
  assert.equal(encoding.rows[0].providerUpdatedAt, now.toISOString().replace("Z", "+00:00"));
  const completed = await db.syncRun.findUnique({ where: { id: guard.id } });
  assert.equal(completed.status, "SUCCEEDED");
  assert.equal(completed.lockOwner, null);
  assert.deepEqual(completed.finishedAt, now);
  const next = new SnapshotWriteBatch(new Date(now.getTime() + 5_000));
  campaign(next, "existing", {}, { name: undefined });
  await next.commit(db, await lease(db));
  assert.deepEqual(await db.campaign.findUnique({ where: { metaId: "existing" } }), after);
});

test("handles thousands of rows and repeated conflict keys inside one batch", async () => {
  const { db } = await database();
  const batch = new SnapshotWriteBatch(now);
  for (let i = 0; i < 2_000; i++) campaign(batch, `campaign-${i}`);
  campaign(batch, "campaign-100", {}, { name: "Last value", dailyBudgetMinor: 0 });
  await batch.commit(db, await lease(db));
  assert.equal(await db.campaign.count(), 2_000);
  const rows = await db.campaign.findMany({ select: { id: true } });
  assert.equal(new Set(rows.map((row) => row.id)).size, 2_000);
  assert.ok(rows.every((row) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)));
  assert.equal((await db.campaign.findUnique({ where: { metaId: "campaign-100" } })).dailyBudgetMinor, 0);
});

test("DailyInsight preserves scope, id and date-only keys while updates set observedAt", async () => {
  const { db } = await database();
  const guard = await lease(db);
  const batch = new SnapshotWriteBatch(now);
  const create = { date: "2026-09-04", level: "account", entityId: "act_test", attributionKey: "7d_click", syncRunId: guard.id, spendMinorUnits: 23 };
  for (const scopeKey of ["account", "campaign-1"]) batch.upsert("DailyInsight", { create: { ...create, scopeKey }, update: {} });
  await batch.commit(db, guard);
  const before = await db.dailyInsight.findFirst({ where: { scopeKey: "account" } });
  const observedAt = new Date(now.getTime() - 1_000);
  const next = new SnapshotWriteBatch();
  next.upsert("DailyInsight", { create: { ...create, scopeKey: "account" }, update: { spendMinorUnits: null, observedAt } });
  await next.commit(db, await lease(db));
  const after = await db.dailyInsight.findUnique({ where: { id: before.id } });
  assert.equal(after.date, "2026-09-04");
  assert.equal(after.spendMinorUnits, null);
  assert.deepEqual(after.observedAt, observedAt);
  assert.equal((await db.dailyInsight.findFirst({ where: { scopeKey: "campaign-1" } })).spendMinorUnits, 23);
});

for (const table of ["SyncRun", "CrmSyncRun"]) {
  test(`${table}: a midbatch failure rolls back new rows, updates and the run transition`, async () => {
    const { db, raw } = await database();
    const guard = await lease(db, table);
    const before = await db.campaign.create({ data: { metaId: "existing", name: "Historical" } });
    await raw.execute(`CREATE TRIGGER fail_middle BEFORE INSERT ON "Campaign" WHEN NEW.metaId = 'bad' BEGIN SELECT RAISE(ABORT, 'middle failed'); END`);
    const batch = new SnapshotWriteBatch(now);
    campaign(batch, "existing");
    campaign(batch, "new");
    campaign(batch, "bad");
    campaign(batch, "after-failure");
    await assert.rejects(batch.commit(db, guard), /middle failed/);
    assert.deepEqual(await db.campaign.findMany(), [before]);
    const run = await raw.execute({ sql: `SELECT status, lockOwner FROM "${table}" WHERE id = ?`, args: [guard.id] });
    assert.equal(run.rows[0].status, "RUNNING");
    assert.equal(run.rows[0].lockOwner, "owner");
  });

  for (const invalid of ["expired", "wrong owner", "wrong key", "missing run", "completed run"]) {
    test(`${table}: ${invalid} cannot commit snapshot rows`, async () => {
      const { db, raw } = await database();
      const guard = await lease(db, table);
      if (invalid === "expired") await raw.execute({ sql: `UPDATE "${table}" SET lockExpiresAt = ? WHERE id = ?`, args: [now.toISOString(), guard.id] });
      if (invalid === "wrong owner") guard.owner = "other";
      if (invalid === "wrong key") guard.lockKey = "other-scope";
      if (invalid === "missing run") guard.id = "missing";
      if (invalid === "completed run") await raw.execute(`UPDATE "${table}" SET status = 'SUCCEEDED'`);
      const batch = new SnapshotWriteBatch(now);
      campaign(batch, "uncommitted");
      await assert.rejects(batch.commit(db, guard), /test lease lost/);
      assert.equal(await db.campaign.count(), 0);
    });
  }

  test(`${table}: lease expiration during writes rolls back everything`, async () => {
    const { db, raw } = await database();
    const guard = await lease(db, table);
    const before = await raw.execute(`SELECT * FROM "${table}"`);
    await raw.execute(`CREATE TRIGGER expire_midbatch AFTER INSERT ON "Campaign" BEGIN UPDATE "${table}" SET lockExpiresAt = 0; END`);
    const batch = new SnapshotWriteBatch(now);
    campaign(batch, "first");
    campaign(batch, "second");
    await assert.rejects(batch.commit(db, guard), /test lease lost/);
    assert.equal(await db.campaign.count(), 0);
    assert.deepEqual((await raw.execute(`SELECT * FROM "${table}"`)).rows, before.rows);
  });
}

test("production lease check uses database wall time, not the earlier completion timestamp", async () => {
  const { db, raw } = await database();
  const guard = await lease(db, "SyncRun", { leaseNow: undefined, completedAt: new Date(0) });
  await raw.execute({ sql: "UPDATE SyncRun SET lockExpiresAt = ? WHERE id = ?", args: [Date.now() - 60_000, guard.id] });
  const batch = new SnapshotWriteBatch();
  campaign(batch, "uncommitted");
  await assert.rejects(batch.commit(db, guard), /test lease lost/);
  assert.equal(await db.campaign.count(), 0);
});

test("CRM provider dates stay strings, nullable updates clear fields and foreign keys remain enforced", async () => {
  const { db } = await database();
  const guard = await lease(db, "CrmSyncRun");
  const contact = { highLevelId: "contact", locationId: "location", attributionGranularity: "ad", sourceSyncRunId: guard.id, dateAdded: "2026-09-04T10:00:00-04:00", metaAdId: "ad" };
  const batch = new SnapshotWriteBatch(now);
  batch.upsert("CrmContact", { create: contact, update: {} });
  batch.upsert("CrmOpportunity", { create: { highLevelId: "opp", locationId: "location", pipelineId: "pipeline", sourceSyncRunId: guard.id, status: "open", createdAtProvider: contact.dateAdded }, update: {} });
  await batch.commit(db, guard);
  const before = await db.crmContact.findFirst();
  assert.equal(before.dateAdded, contact.dateAdded);
  assert.equal((await db.crmOpportunity.findFirst()).createdAtProvider, contact.dateAdded);
  const next = new SnapshotWriteBatch();
  next.upsert("CrmContact", { create: contact, update: { dateAdded: undefined, metaAdId: null } });
  await next.commit(db, await lease(db, "CrmSyncRun"));
  const after = await db.crmContact.findFirst();
  assert.equal(after.id, before.id);
  assert.deepEqual(after.createdAt, before.createdAt);
  assert.equal(after.metaAdId, null);
  assert.equal(after.dateAdded, before.dateAdded);
  const invalid = new SnapshotWriteBatch();
  campaign(invalid, "must-rollback");
  invalid.upsert("CrmContact", { create: { ...contact, highLevelId: "bad", sourceSyncRunId: "missing" }, update: {} });
  await assert.rejects(invalid.commit(db, await lease(db, "CrmSyncRun")), /FOREIGN KEY constraint failed/);
  assert.equal(await db.campaign.count(), 0);
  assert.equal(await db.crmContact.count(), 1);
});

test("raw connections stay bound to the explicit Prisma file target and close on success/failure", async () => {
  const first = await database();
  const other = await database();
  const saved = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = other.url;
  try {
    const batch = new SnapshotWriteBatch();
    campaign(batch, "only-first");
    await batch.commit(first.db, await lease(first.db));
    assert.equal(await first.db.campaign.count(), 1);
    assert.equal(await other.db.campaign.count(), 0);
    let connection;
    await withDatabaseClient(first.db, async (client) => { connection = client; await client.execute("SELECT 1"); });
    assert.equal(connection.closed, true);
    await assert.rejects(withDatabaseClient(first.db, async (client) => { connection = client; throw new Error("callback failure"); }), /callback failure/);
    assert.equal(connection.closed, true);
    await assert.rejects(withDatabaseClient({}, async () => assert.fail("must not open a fallback")), /target is unknown/);
  } finally {
    if (saved === undefined) delete process.env.TURSO_DATABASE_URL;
    else process.env.TURSO_DATABASE_URL = saved;
  }
});

test("explicit URL/token binding never borrows changed environment credentials (transport stub only)", async () => {
  const saved = { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN };
  const requests = [];
  mock.method(globalThis, "fetch", async (input, init) => {
    requests.push(new Request(input, init));
    throw new Error("local test transport stub");
  });
  process.env.TURSO_DATABASE_URL = "https://original.invalid";
  process.env.TURSO_AUTH_TOKEN = "original-test-token";
  const explicit = createPrismaClient({ url: "https://explicit.invalid", authToken: "explicit-test-token" });
  const noToken = createPrismaClient({ url: "https://no-token.invalid" });
  const implicit = createPrismaClient();
  process.env.TURSO_DATABASE_URL = "https://changed.invalid";
  process.env.TURSO_AUTH_TOKEN = "changed-test-token";
  try {
    for (const [db, host, token] of [[explicit, "explicit.invalid", "Bearer explicit-test-token"], [noToken, "no-token.invalid", null], [implicit, "original.invalid", "Bearer original-test-token"]]) {
      requests.length = 0;
      await assert.rejects(withDatabaseClient(db, (client) => client.execute("SELECT 1")));
      assert.ok(requests.length > 0);
      assert.ok(requests.every((request) => new URL(request.url).hostname === host));
      assert.ok(requests.every((request) => request.headers.get("authorization") === token));
    }
  } finally {
    await Promise.all([explicit.$disconnect(), noToken.$disconnect(), implicit.$disconnect()]);
    if (saved.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = saved.url;
    if (saved.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = saved.token;
  }
});

test("unconfigured or TLS-disabled production targets and private memory databases fail closed", async () => {
  const saved = { node: process.env.NODE_ENV, url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN };
  let requests = 0;
  mock.method(globalThis, "fetch", async () => { requests++; throw new Error("unexpected transport use"); });
  try {
    process.env.NODE_ENV = "production";
    process.env.TURSO_DATABASE_URL = "libsql://unsafe.invalid?tls=0";
    process.env.TURSO_AUTH_TOKEN = "test-token";
    const blocked = createPrismaClient();
    assert.throws(() => blocked.syncRun, /Database configuration is required/);
    await assert.rejects(withDatabaseClient(blocked, async () => assert.fail()), /target is unknown/);
    assert.equal(requests, 0);
    const memory = createPrismaClient({ url: "file::memory:" });
    try {
      await assert.rejects(withDatabaseClient(memory, async () => assert.fail()), /shared file or remote/);
    } finally { await memory.$disconnect(); }
  } finally {
    if (saved.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.node;
    if (saved.url === undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL = saved.url;
    if (saved.token === undefined) delete process.env.TURSO_AUTH_TOKEN; else process.env.TURSO_AUTH_TOKEN = saved.token;
  }
});
