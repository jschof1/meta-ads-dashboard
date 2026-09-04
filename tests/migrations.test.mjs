import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const fixtures = [];

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-migrations-pr03-"));
  const path = join(directory, "test.db");
  fixtures.push({ directory, path });
  return { directory, path };
}

function deploy(path) {
  execFileSync(npx, ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: root,
    env: {
      ...process.env,
      // Prisma 6.19's macOS schema engine can exit without a diagnostic when
      // its default Rust logger is disabled; info logging keeps this check
      // deterministic while remaining quiet on successful migrations.
      RUST_LOG: "info",
      DATABASE_URL: `file:${path}`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function executeMigrationScript(path) {
  execFileSync(npx, ["prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", "prisma/migrations/20260904170000_pr03_sync_data/migration.sql"], {
    cwd: root,
    env: {
      ...process.env,
      RUST_LOG: "info",
      DATABASE_URL: `file:${path}`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function baselineMigration(path) {
  execFileSync(npx, ["prisma", "migrate", "resolve", "--applied", "20260904170000_pr03_sync_data", "--schema", "prisma/schema.prisma"], {
    cwd: root,
    env: {
      ...process.env,
      RUST_LOG: "info",
      DATABASE_URL: `file:${path}`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("applies the PR03 schema through Prisma migrate deploy", async () => {
  const { path } = await temporaryDatabase();
  deploy(path);
  const db = createPrismaClient({ url: `file:${path}` });

  const migrations = await db.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations"');
  const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'");

  assert.deepEqual(migrations.map((row) => row.migration_name), ["20260904170000_pr03_sync_data"]);
  for (const table of ["Campaign", "AdSet", "Ad", "Creative", "DailyInsight", "SyncRun"]) {
    assert.ok(tables.some((row) => row.name === table), `missing ${table}`);
  }
  await db.$disconnect();
});

test("upgrades a legacy PR01/PR02 database without dropping stored rows", async () => {
  const { path } = await temporaryDatabase();
  const legacy = createPrismaClient({ url: `file:${path}` });
  await legacy.$executeRawUnsafe(`CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "linkClicks" INTEGER NOT NULL,
    "registrations" INTEGER NOT NULL,
    "callsBooked" INTEGER NOT NULL,
    "enrollments" INTEGER NOT NULL,
    "cprCents" INTEGER,
    "ctrLink" REAL,
    "cpmCents" INTEGER,
    "frequency" REAL,
    "raw" TEXT NOT NULL DEFAULT '{}'
  )`);
  await legacy.$executeRawUnsafe(`CREATE TABLE "AdDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "linkClicks" INTEGER NOT NULL,
    "ctrLink" REAL NOT NULL,
    "registrations" INTEGER NOT NULL,
    "cprCents" INTEGER,
    "frequency" REAL NOT NULL
  )`);
  await legacy.$executeRawUnsafe(`CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "executor" TEXT NOT NULL,
    "result" TEXT
  )`);
  await legacy.$executeRawUnsafe(`INSERT INTO "Snapshot" ("id", "window", "spendCents", "impressions", "clicks", "linkClicks", "registrations", "callsBooked", "enrollments") VALUES ('legacy-snapshot', 'last_30d', 1234, 100, 10, 8, 2, 0, 0)`);
  await legacy.$executeRawUnsafe(`INSERT INTO "AdDaily" ("id", "date", "adId", "adName", "status", "spendCents", "impressions", "linkClicks", "ctrLink", "registrations", "cprCents", "frequency") VALUES ('legacy-ad-daily', '2026-09-04', 'legacy-ad', 'Legacy ad', 'ACTIVE', 456, 50, 5, 0.1, 1, 456, 1.2)`);
  await legacy.$executeRawUnsafe(`INSERT INTO "ActionLog" ("id", "action", "targetId", "reasoning", "executor", "result") VALUES ('legacy-action', 'PAUSE_AD', 'legacy-ad', 'Legacy reasoning', 'human', 'queued')`);
  await legacy.$disconnect();

  // Existing PR01/PR02 databases were provisioned with `db push`, so they do
  // not have migration history. Apply the idempotent SQL once, then baseline
  // that already-applied change so future deploys are ordinary no-ops.
  executeMigrationScript(path);
  baselineMigration(path);
  deploy(path);
  const upgraded = createPrismaClient({ url: `file:${path}` });
  const snapshot = await upgraded.snapshot.findUnique({ where: { id: "legacy-snapshot" } });
  const adDaily = await upgraded.adDaily.findUnique({ where: { date_adId: { date: "2026-09-04", adId: "legacy-ad" } } });
  const action = await upgraded.actionLog.findUnique({ where: { id: "legacy-action" } });
  const legacyTables = await upgraded.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Snapshot', 'AdDaily', 'ActionLog') ORDER BY name");
  const campaignTable = await upgraded.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Campaign'");
  const migration = await upgraded.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations"');

  assert.equal(snapshot.spendCents, 1234);
  assert.equal(adDaily.adName, "Legacy ad");
  assert.equal(action.action, "PAUSE_AD");
  assert.equal(action.result, "queued");
  assert.deepEqual(legacyTables.map((row) => row.name), ["ActionLog", "AdDaily", "Snapshot"]);
  assert.equal(campaignTable[0].name, "Campaign");
  assert.equal(migration[0].migration_name, "20260904170000_pr03_sync_data");
  await upgraded.$disconnect();
});

test("fails closed when a legacy table has an incompatible schema", async () => {
  const { path } = await temporaryDatabase();
  const legacy = createPrismaClient({ url: `file:${path}` });
  await legacy.$executeRawUnsafe(`CREATE TABLE "Snapshot" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await legacy.$disconnect();

  assert.throws(() => executeMigrationScript(path));
});
