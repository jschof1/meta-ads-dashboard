import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { createPrismaClient } from "../lib/db.ts";
import { normalizeSql, quoteIdentifier, readCommittedMigrations, readSchemaSnapshot, schemaDifferences, splitSqlStatements } from "../scripts/turso-schema.mjs";
import { recordBaseline } from "../scripts/record-turso-baseline.mjs";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const migrationsDirectory = join(root, "prisma", "migrations");
const fixtures = [];

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-turso-baseline-"));
  const path = join(directory, "test.db");
  fixtures.push({ directory, path });
  return path;
}

async function createUntrackedSchema(path, through = null) {
  const client = createClient({ url: `file:${path}` });
  try {
    const migrations = await readCommittedMigrations(migrationsDirectory);
    const throughIndex = through == null
      ? migrations.length - 1
      : migrations.findIndex((migration) => migration.name === through);
    for (const migration of migrations.slice(0, throughIndex + 1)) {
      await client.batch(splitSqlStatements(migration.sql).map((sql) => ({ sql })), "write");
    }
  } finally {
    client.close();
  }
}

function runBaseline(path, overrides = {}) {
  return execFileSync(process.execPath, ["scripts/record-turso-baseline.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      TURSO_DATABASE_URL: `file:${path}`,
      TURSO_AUTH_TOKEN: "turso-test-secret",
      TURSO_MIGRATION_CONFIRM: "yes",
      TURSO_BASELINE_CONFIRM: "yes",
      TURSO_MIGRATION_ALLOW_LOCAL: "yes",
      TURSO_BASELINE_THROUGH: "",
      ...overrides,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function databaseState(client, includeLedger = true) {
  const schema = await readSchemaSnapshot(client);
  const tables = schema.objects.filter((object) => object.type === "table"
    && !object.name.startsWith("sqlite_") && (includeLedger || object.name !== "_prisma_migrations"));
  const data = {};
  for (const { name } of tables) {
    const result = await client.execute(`SELECT * FROM ${quoteIdentifier(name)}`);
    data[name] = result.rows.map((row) => Array.from(row));
  }
  return { objects: includeLedger ? schema.objects : schema.objects.filter((object) => object.tableName !== "_prisma_migrations"), data };
}

async function seedCampaign(client) {
  await client.execute({
    sql: `INSERT INTO "Campaign" ("id", "metaId", "name", "raw", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["legacy-campaign", "legacy-campaign", "Legacy  campaign\nO'Brien", '{"value":"two  spaces"}', "2026-01-01 00:00:00", "2026-01-02 00:00:00"],
  });
}

async function assertLedgerChecksums(client, count) {
  const migrations = (await readCommittedMigrations(migrationsDirectory)).slice(0, count);
  const result = await client.execute('SELECT migration_name, checksum, applied_steps_count FROM _prisma_migrations ORDER BY migration_name');
  assert.deepEqual(result.rows.map((row) => Array.from(row)), migrations.map((migration) => [migration.name, createHash("sha256").update(migration.sql).digest("hex"), 1]));
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("records a complete legacy baseline without changing application rows", async () => {
  const path = await temporaryDatabase();
  await createUntrackedSchema(path);
  const before = createPrismaClient({ url: `file:${path}` });
  await before.$executeRawUnsafe('INSERT INTO "Campaign" ("id", "metaId", "name", "raw", "createdAt", "updatedAt") VALUES (\'legacy-campaign\', \'legacy-campaign\', \'Legacy campaign\', \'{}\', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)');
  await before.$disconnect();
  const client = createClient({ url: `file:${path}` });
  await client.execute(`INSERT INTO "AuthRateLimit" ("keyHash", "count", "resetAt", "updatedAt") VALUES ('legacy-hash', 4, '2026-10-01', '2026-09-01')`);
  const beforeState = await databaseState(client, false);

  assert.match(runBaseline(path), /Recorded baseline ledger through 20260905160000_pr10_production_hardening for 7 migrations\./);

  const after = createPrismaClient({ url: `file:${path}` });
  const campaign = await after.campaign.findUnique({ where: { metaId: "legacy-campaign" } });
  const ledger = await after.$queryRawUnsafe('SELECT "migration_name", "checksum", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "started_at" ASC');
  assert.equal(campaign.name, "Legacy campaign");
  assert.equal(ledger.length, 7);
  assert.ok(ledger.every((row) => row.checksum.length === 64 && row.applied_steps_count === 1));
  await after.$disconnect();
  assert.deepEqual(await databaseState(client, false), beforeState);
  await assertLedgerChecksums(client, 7);
  client.close();
});

test("refuses to baseline a legacy schema with a structural mismatch", async () => {
  const path = await temporaryDatabase();
  await createUntrackedSchema(path);
  const db = createPrismaClient({ url: `file:${path}` });
  await db.$executeRawUnsafe('DROP INDEX "AuthRateLimit_resetAt_idx"');
  await db.$disconnect();

  assert.throws(() => runBaseline(path), /does not match committed migrations/);

  const check = createPrismaClient({ url: `file:${path}` });
  const ledger = await check.$queryRawUnsafe('SELECT name FROM "sqlite_master" WHERE type = \'table\' AND name = \'_prisma_migrations\'');
  assert.equal(ledger.length, 0);
  await check.$disconnect();
});

test("records an earlier baseline so the normal migration command can apply pending changes", async () => {
  const path = await temporaryDatabase();
  const through = "20260905143000_pr09_approved_meta_actions";
  await createUntrackedSchema(path, through);
  const client = createClient({ url: `file:${path}` });
  await seedCampaign(client);
  const before = await databaseState(client, false);

  const inspection = execFileSync(process.execPath, ["scripts/inspect-turso-schema.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", TURSO_DATABASE_URL: `file:${path}`, TURSO_AUTH_TOKEN: "test-only", TURSO_MIGRATION_ALLOW_LOCAL: "yes", TURSO_BASELINE_THROUGH: through },
    encoding: "utf8",
  });
  assert.match(inspection, /Schema compatibility: compatible through 20260905143000_pr09_approved_meta_actions/);
  assert.match(runBaseline(path, { TURSO_BASELINE_THROUGH: through }), /through 20260905143000_pr09_approved_meta_actions for 6 migrations/);
  assert.deepEqual(await databaseState(client, false), before);
  await assertLedgerChecksums(client, 6);
  const migrate = execFileSync(process.execPath, ["scripts/apply-turso-migrations.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "test",
      TURSO_DATABASE_URL: `file:${path}`,
      TURSO_AUTH_TOKEN: "turso-test-secret",
      TURSO_MIGRATION_CONFIRM: "yes",
      TURSO_MIGRATION_ALLOW_LOCAL: "yes",
    },
    encoding: "utf8",
  });
  assert.match(migrate, /Applied 20260905160000_pr10_production_hardening/);

  const db = createPrismaClient({ url: `file:${path}` });
  const ledger = await db.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "started_at" ASC');
  const tables = await db.$queryRawUnsafe('SELECT "name" FROM "sqlite_master" WHERE "type" = \'table\'');
  assert.equal(ledger.length, 7);
  assert.ok(tables.some((row) => row.name === "AuthRateLimit"));
  await db.$disconnect();
  const after = await databaseState(client, false);
  for (const [table, rows] of Object.entries(before.data)) assert.deepEqual(after.data[table], rows);
  await assertLedgerChecksums(client, 7);
  client.close();
});

test("baselines populated PR03 then upgrades columns and indexes with all original values preserved", async () => {
  const path = await temporaryDatabase();
  const through = "20260904170000_pr03_sync_data";
  await createUntrackedSchema(path, through);
  const client = createClient({ url: `file:${path}` });
  try {
    await seedCampaign(client);
    await client.execute(`INSERT INTO "SyncRun" ("id", "accountId", "trigger", "status", "attributionKey", "startedAt", "finishedAt")
      VALUES ('legacy-run', 'act_legacy', 'manual', 'SUCCEEDED', '7d_click', '2026-09-01', '2026-09-01')`);
    await client.execute(`INSERT INTO "DailyInsight" ("id", "date", "level", "entityId", "attributionKey", "spendMinorUnits", "impressions", "syncRunId")
      VALUES ('legacy-insight', '2026-09-01', 'account', 'act_legacy', '7d_click', 1234, 1000, 'legacy-run')`);
    const before = await databaseState(client, false);
    const schema = await readSchemaSnapshot(client);
    assert.match(runBaseline(path, { TURSO_BASELINE_THROUGH: through }), /for 1 migrations/);
    assert.deepEqual(await databaseState(client, false), before);
    await assertLedgerChecksums(client, 1);
    const options = {
      cwd: root,
      env: { ...process.env, NODE_ENV: "test", TURSO_DATABASE_URL: `file:${path}`, TURSO_AUTH_TOKEN: "test-only", TURSO_MIGRATION_CONFIRM: "yes", TURSO_MIGRATION_ALLOW_LOCAL: "yes" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    };
    assert.match(execFileSync(process.execPath, ["scripts/apply-turso-migrations.mjs"], options), /Applied 6 Turso migrations/);
    for (const table of schema.tables) {
      const columns = table.columns.map((column) => quoteIdentifier(column.name)).join(", ");
      const result = await client.execute(`SELECT ${columns} FROM ${quoteIdentifier(table.name)}`);
      assert.deepEqual(result.rows.map((row) => Array.from(row)), before.data[table.name], table.name);
    }
    assert.equal((await client.execute('SELECT "scopeKey" FROM "DailyInsight"')).rows[0].scopeKey, "account");
    await assertLedgerChecksums(client, 7);
    assert.match(execFileSync(process.execPath, ["scripts/apply-turso-migrations.mjs"], options), /up to date/);
  } finally { client.close(); }
});

for (const [label, sql] of [
  ["index collation", 'DROP INDEX "AuthRateLimit_resetAt_idx"; CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"("resetAt" COLLATE NOCASE)'],
  ["index order", 'DROP INDEX "AuthRateLimit_resetAt_idx"; CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"("resetAt" DESC)'],
  ["index expression", 'DROP INDEX "AuthRateLimit_resetAt_idx"; CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"(lower("resetAt"))'],
  ["index predicate", 'DROP INDEX "AuthRateLimit_resetAt_idx"; CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"("resetAt") WHERE "count" > 0'],
  ["trigger", 'CREATE TRIGGER "drift_trigger" AFTER INSERT ON "Campaign" BEGIN DELETE FROM "Campaign" WHERE id = NEW.id; END'],
  ["view", 'CREATE VIEW "drift_view" AS SELECT name FROM "Campaign"'],
]) {
  test(`rejects ${label} drift without ledger artifacts or data changes`, async () => {
    const path = await temporaryDatabase();
    await createUntrackedSchema(path);
    const client = createClient({ url: `file:${path}` });
    try {
      await seedCampaign(client);
      await client.executeMultiple(sql);
      const before = await databaseState(client);
      assert.throws(() => runBaseline(path), /does not match committed migrations/);
      assert.deepEqual(await databaseState(client), before);
      assert.ok(!before.objects.some((object) => object.name.includes("prisma_migrations")));
    } finally { client.close(); }
  });
}

test("compares partial predicates, expression SQL and literal whitespace without loss", async () => {
  assert.notEqual(normalizeSql("SELECT 'a  b'"), normalizeSql("SELECT 'a b'"));
  assert.notEqual(normalizeSql('SELECT "a  b"'), normalizeSql('SELECT "a b"'));
  assert.notEqual(normalizeSql("SELECT 1 -- comment\n + 2"), normalizeSql("SELECT 1 -- comment + 2"));
  for (const [first, second] of [
    ["CREATE INDEX example_idx ON example(value) WHERE value = 'a  b'", "CREATE INDEX example_idx ON example(value) WHERE value = 'a b'"],
    ["CREATE INDEX example_idx ON example(lower(value))", "CREATE INDEX example_idx ON example(upper(value))"],
    ["CREATE TABLE example(value TEXT CHECK (value != 'a  b'))", "CREATE TABLE example(value TEXT CHECK (value != 'a b'))"],
    ["CREATE TABLE example(value TEXT DEFAULT 'a  b')", "CREATE TABLE example(value TEXT DEFAULT 'a b')"],
  ]) {
    const client = createClient({ url: `file:${await temporaryDatabase()}` });
    try {
      if (first.startsWith("CREATE INDEX")) await client.execute("CREATE TABLE example(value TEXT)");
      await client.execute(first);
      const expected = await readSchemaSnapshot(client);
      await client.execute(first.startsWith("CREATE INDEX") ? "DROP INDEX example_idx" : "DROP TABLE example");
      await client.execute(second);
      assert.ok(schemaDifferences(expected, await readSchemaSnapshot(client)).length > 0);
    } finally { client.close(); }
  }
});

for (const [label, mutate] of [
  ["index replacement", async (client) => client.executeMultiple('DROP INDEX "AuthRateLimit_resetAt_idx"; CREATE INDEX "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"("resetAt" DESC)')],
  ["new trigger", async (client) => client.execute('CREATE TRIGGER concurrent_trigger AFTER INSERT ON "Campaign" BEGIN SELECT 1; END')],
  ["create/drop ABA", async (client) => client.executeMultiple("CREATE TABLE transient_table(id); DROP TABLE transient_table")],
  ["concurrent empty ledger", async (client) => client.execute("CREATE TABLE _prisma_migrations (id TEXT)")],
  ["concurrent completed baseline", async (client) => recordBaseline(client)],
]) {
  test(`atomic baseline rejects ${label} after inspection and preserves the other writer`, async () => {
    const path = await temporaryDatabase();
    await createUntrackedSchema(path);
    const client = createClient({ url: `file:${path}` });
    const other = createClient({ url: `file:${path}` });
    let afterMutation;
    const modes = [];
    try {
      await seedCampaign(client);
      const interceptedClient = {
        async batch(statements, mode) {
          modes.push(mode);
          if (mode === "write") {
            await mutate(other);
            afterMutation = await databaseState(other);
          }
          return client.batch(statements, mode);
        },
      };
      await assert.rejects(recordBaseline(interceptedClient), /integer overflow/);
      assert.deepEqual(modes, ["read", "write"]);
      assert.deepEqual(await databaseState(client), afterMutation);
    } finally { client.close(); other.close(); }
  });
}

test("a late ledger insert failure rolls back the entire baseline including table and index", async () => {
  const path = await temporaryDatabase();
  await createUntrackedSchema(path);
  const client = createClient({ url: `file:${path}` });
  try {
    await seedCampaign(client);
    const before = await databaseState(client);
    const interceptedClient = {
      batch(statements, mode) {
        if (mode === "write") {
          const inserts = statements.filter((statement) => statement.sql?.startsWith('INSERT INTO "_prisma_migrations"'));
          inserts.at(-1).args[0] = inserts[0].args[0];
        }
        return client.batch(statements, mode);
      },
    };
    await assert.rejects(recordBaseline(interceptedClient), /UNIQUE constraint failed/);
    assert.deepEqual(await databaseState(client), before);
  } finally { client.close(); }
});

test("rejects existing ledger and invalid baseline target without mutations", async () => {
  const path = await temporaryDatabase();
  await createUntrackedSchema(path);
  const client = createClient({ url: `file:${path}` });
  try {
    const before = await databaseState(client);
    assert.throws(() => runBaseline(path, { TURSO_BASELINE_THROUGH: "unknown" }), /must name a committed migration/);
    assert.deepEqual(await databaseState(client), before);
    runBaseline(path);
    const withLedger = await databaseState(client);
    assert.throws(() => runBaseline(path), /ledger already exists/);
    assert.deepEqual(await databaseState(client), withLedger);
  } finally { client.close(); }
});

test("requires the explicit baseline confirmation", async () => {
  const path = await temporaryDatabase();
  assert.throws(
    () => runBaseline(path, { TURSO_BASELINE_CONFIRM: "no" }),
    /TURSO_BASELINE_CONFIRM=yes/,
  );
});
