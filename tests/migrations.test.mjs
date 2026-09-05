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

test("applies the committed schema through Prisma migrate deploy", async () => {
  const { path } = await temporaryDatabase();
  deploy(path);
  const db = createPrismaClient({ url: `file:${path}` });

  const migrations = await db.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations"');
  const tables = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'");
  const campaignColumns = await db.$queryRawUnsafe('PRAGMA table_info("Campaign")');
  const adSetColumns = await db.$queryRawUnsafe('PRAGMA table_info("AdSet")');
  const adColumns = await db.$queryRawUnsafe('PRAGMA table_info("Ad")');
  const creativeColumns = await db.$queryRawUnsafe('PRAGMA table_info("Creative")');
  const dailyInsightColumns = await db.$queryRawUnsafe('PRAGMA table_info("DailyInsight")');
  const syncRunColumns = await db.$queryRawUnsafe('PRAGMA table_info("SyncRun")');
  const recommendationColumns = await db.$queryRawUnsafe('PRAGMA table_info("Recommendation")');
  const aiBriefingColumns = await db.$queryRawUnsafe('PRAGMA table_info("AiBriefing")');
  const crmSyncRunColumns = await db.$queryRawUnsafe('PRAGMA table_info("CrmSyncRun")');
  const crmContactColumns = await db.$queryRawUnsafe('PRAGMA table_info("CrmContact")');
  const crmOpportunityColumns = await db.$queryRawUnsafe('PRAGMA table_info("CrmOpportunity")');
  const crmContactIndexes = await db.$queryRawUnsafe('PRAGMA index_list("CrmContact")');
  const crmOpportunityIndexes = await db.$queryRawUnsafe('PRAGMA index_list("CrmOpportunity")');

  assert.deepEqual(migrations.map((row) => row.migration_name), ["20260904170000_pr03_sync_data", "20260904193000_pr05_operator_dashboard", "20260904210000_pr06_recommendation_engine", "20260905120000_pr07_ai_briefings", "20260905133000_pr08_highlevel_attribution"]);
  for (const table of ["Campaign", "AdSet", "Ad", "Creative", "DailyInsight", "SyncRun", "Recommendation", "AiBriefing", "CrmSyncRun", "CrmContact", "CrmOpportunity"]) {
    assert.ok(tables.some((row) => row.name === table), `missing ${table}`);
  }
  for (const [name, columns] of [["Campaign", campaignColumns], ["AdSet", adSetColumns], ["Ad", adColumns], ["Creative", creativeColumns]]) {
    assert.ok(columns.some((column) => column.name === "providerUpdatedAt"), `${name} missing providerUpdatedAt`);
    assert.ok(columns.some((column) => column.name === "lastSeenSyncRunId"), `${name} missing lastSeenSyncRunId`);
  }
  assert.ok(campaignColumns.some((column) => column.name === "dailyBudgetMinor"), "Campaign missing dailyBudgetMinor");
  assert.ok(campaignColumns.some((column) => column.name === "lifetimeBudgetMinor"), "Campaign missing lifetimeBudgetMinor");
  assert.ok(dailyInsightColumns.some((column) => column.name === "scopeKey"), "DailyInsight missing scopeKey");
  assert.ok(syncRunColumns.some((column) => column.name === "campaignId"), "SyncRun missing campaignId");
  for (const column of ["fingerprint", "accountId", "campaignId", "attributionKey", "type", "analysisWindowDays", "ruleVersion", "targetId", "lifecycle", "evidence", "proposedAction"]) {
    assert.ok(recommendationColumns.some((candidate) => candidate.name === column), `Recommendation missing ${column}`);
  }
  for (const column of ["kind", "accountId", "campaignId", "attributionKey", "period", "dataHash", "output", "evidence", "provider", "model", "sourceSyncRunId", "snapshotKey", "generatedAt"]) {
    assert.ok(aiBriefingColumns.some((candidate) => candidate.name === column), `AiBriefing missing ${column}`);
  }
  for (const column of ["locationId", "pipelineId", "mappingHash", "contactsFetched", "opportunitiesFetched", "lockKey"]) {
    assert.ok(crmSyncRunColumns.some((candidate) => candidate.name === column), `CrmSyncRun missing ${column}`);
  }
  for (const column of ["highLevelId", "locationId", "attributionGranularity", "metaAdId", "metaCampaignId", "clickIds", "sourceSyncRunId"]) {
    assert.ok(crmContactColumns.some((candidate) => candidate.name === column), `CrmContact missing ${column}`);
  }
  for (const column of ["highLevelId", "locationId", "contactId", "pipelineId", "pipelineStageId", "status", "semanticStage", "valueMajorUnits", "sourceSyncRunId"]) {
    assert.ok(crmOpportunityColumns.some((candidate) => candidate.name === column), `CrmOpportunity missing ${column}`);
  }
  assert.ok(crmContactIndexes.some((index) => index.name === "CrmContact_locationId_highLevelId_key"), "CrmContact missing location-scoped uniqueness");
  assert.ok(crmOpportunityIndexes.some((index) => index.name === "CrmOpportunity_locationId_pipelineId_highLevelId_key"), "CrmOpportunity missing location/pipeline-scoped uniqueness");
  await db.$disconnect();
});

test("upgrades a populated PR03 database without dropping durable rows", async () => {
  const { path } = await temporaryDatabase();
  executeMigrationScript(path);
  const legacy = createPrismaClient({ url: "file:" + path });
  await legacy.$executeRawUnsafe("INSERT INTO \"Campaign\" (\"id\", \"metaId\", \"name\", \"raw\", \"createdAt\", \"updatedAt\") VALUES ('pr03-campaign', 'pr03-campaign', 'Existing campaign', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  await legacy.$executeRawUnsafe("INSERT INTO \"SyncRun\" (\"id\", \"accountId\", \"trigger\", \"status\", \"attributionKey\", \"startedAt\", \"finishedAt\") VALUES ('pr03-run', 'act_pr03', 'manual', 'SUCCEEDED', '7d_click,1d_view', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  await legacy.$executeRawUnsafe("INSERT INTO \"DailyInsight\" (\"id\", \"date\", \"level\", \"entityId\", \"attributionKey\", \"spendMinorUnits\", \"impressions\", \"syncRunId\") VALUES ('pr03-insight', '2026-09-04', 'account', 'act_pr03', '7d_click,1d_view', 1234, 1000, 'pr03-run')");
  await legacy.$disconnect();

  baselineMigration(path);
  deploy(path);
  const upgraded = createPrismaClient({ url: "file:" + path });
  const campaign = await upgraded.campaign.findUnique({ where: { metaId: "pr03-campaign" } });
  const insight = await upgraded.dailyInsight.findUnique({ where: { id: "pr03-insight" } });
  const migrations = await upgraded.$queryRawUnsafe("SELECT \"migration_name\" FROM \"_prisma_migrations\"");

  assert.equal(campaign.name, "Existing campaign");
  assert.equal(insight.spendMinorUnits, 1234);
  assert.equal(insight.scopeKey, "account");
  assert.deepEqual(migrations.map((row) => row.migration_name), ["20260904170000_pr03_sync_data", "20260904193000_pr05_operator_dashboard", "20260904210000_pr06_recommendation_engine", "20260905120000_pr07_ai_briefings", "20260905133000_pr08_highlevel_attribution"]);
  await upgraded.$disconnect();
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
