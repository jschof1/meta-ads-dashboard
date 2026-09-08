import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../lib/db.ts";
import { SnapshotWriteBatch } from "../lib/snapshot-write-batch.ts";
import { syncHighLevel } from "../lib/highlevel-sync.ts";
import { loadHighLevelSettings } from "../lib/highlevel-config.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";
import { analyseRecommendations, metricsFromTotals } from "../lib/recommendations.ts";
import { persistRecommendationLifecycle } from "../lib/recommendation-store.ts";
import { runCommand, startLibsqlSmokeServer, stopLibsqlSmokeServer } from "./libsql-smoke-server.mjs";

async function checkRemoteSnapshot() {
  assert.equal(new URL(process.env.TURSO_DATABASE_URL).hostname, "127.0.0.1", "this test only accepts the isolated loopback fixture");
  const db = createPrismaClient();
  try {
    assert.equal(await db.crmSyncRun.count(), 0, "expected an empty disposable fixture");
    const config = loadHighLevelSettings({
      HIGHLEVEL_TOKEN: "synthetic-token-never-sent", HIGHLEVEL_LOCATION_ID: "remote-fixture-location",
      HIGHLEVEL_PIPELINE_ID: "remote-fixture-pipeline", HIGHLEVEL_SYNC_ENABLED: "true",
      HIGHLEVEL_STAGE_LEAD_ID: "lead", HIGHLEVEL_STAGE_CONTACTED_ID: "contacted",
      HIGHLEVEL_STAGE_QUALIFIED_ID: "qualified", HIGHLEVEL_STAGE_CALL_BOOKED_ID: "booked",
      HIGHLEVEL_STAGE_CALL_ATTENDED_ID: "attended", HIGHLEVEL_WON_STATUS: "won", HIGHLEVEL_LOST_STATUS: "lost",
      HIGHLEVEL_CURRENCY_CODE: "GBP",
    });
    const contacts = Array.from({ length: 3_000 }, (_, id) => ({ id: `synthetic-contact-${id}`, locationId: config.locationId, dateAdded: new Date().toISOString() }));
    const opportunities = contacts.slice(0, 1_000).map((contact, id) => ({ id: `synthetic-opportunity-${id}`, locationId: config.locationId, pipelineId: config.pipelineId, pipelineStageId: "qualified", status: "open", contactId: contact.id }));
    const collection = (items) => ({ items, providerTotal: items.length, truncated: false });
    const client = {
      getPipeline: async () => ({ id: config.pipelineId, locationId: config.locationId, stages: Object.values(config.stageIds).map((id) => ({ id, name: id })) }),
      listContacts: async () => collection(contacts),
      listOpportunities: async () => collection(opportunities),
    };
    const started = Date.now();
    const first = await syncHighLevel({ db, config, client });
    assert.equal(first.status, "SUCCEEDED");
    assert.equal(await db.crmContact.count({ where: { sourceSyncRunId: first.runId } }), 3_000);
    assert.equal(await db.crmOpportunity.count({ where: { sourceSyncRunId: first.runId } }), 1_000);
    const record = await db.crmContact.findFirst();
    const second = await syncHighLevel({ db, config, client });
    const updated = await db.crmContact.findUnique({ where: { id: record.id } });
    assert.equal(updated.sourceSyncRunId, second.runId);
    assert.deepEqual(updated.createdAt, record.createdAt);
    await assert.rejects(() => syncHighLevel({ db, config, client: { ...client, listContacts: async () => ({ ...collection(contacts.slice(0, 1)), truncated: true, providerTotal: 3_000 }) } }), /incomplete snapshot/);
    assert.equal(await db.crmContact.count({ where: { sourceSyncRunId: second.runId } }), 3_000);

    const run = await db.syncRun.create({ data: { accountId: "act_remote-fixture", attributionKey: "7d_click", trigger: "synthetic", status: "RUNNING", lockKey: "remote-fixture", lockOwner: "fixture-owner", lockExpiresAt: new Date(Date.now() + 60_000) } });
    const lease = { table: "SyncRun", id: run.id, owner: run.lockOwner, lockKey: run.lockKey, completedAt: new Date(), data: {}, lostLeaseError: new Error("Fixture lease lost") };
    const batch = new SnapshotWriteBatch();
    batch.upsert("Campaign", { create: { metaId: "synthetic-rollback", name: "Must roll back" }, update: {} });
    batch.upsert("Campaign", { create: { metaId: "synthetic-invalid" }, update: {} });
    await assert.rejects(() => batch.commit(db, lease));
    assert.equal(await db.campaign.count(), 0);
    assert.equal((await db.syncRun.findUnique({ where: { id: run.id } })).status, "RUNNING");
    await db.syncRun.update({ where: { id: run.id }, data: { lockExpiresAt: new Date(Date.now() - 1_000) } });
    const expired = new SnapshotWriteBatch();
    expired.upsert("Campaign", { create: { metaId: "synthetic-expired", name: "Must roll back" }, update: {} });
    await assert.rejects(() => expired.commit(db, lease), /Fixture lease lost/);
    assert.equal(await db.campaign.count(), 0);

    const metrics = metricsFromTotals({ spendCents: null, impressions: null, reach: null, clicks: null, linkClicks: null, leads: null, frequency: null });
    const template = analyseRecommendations({ config: UKTL_CONFIG, target: { type: "ad", id: "synthetic-ad", name: "Synthetic missing-data fixture" }, comparisonDays: 7, current: metrics, previous: null, cumulative: null, status: "ACTIVE", learningState: null, series: [], sampleSize: 0, daysActive: null }).recommendations[0];
    assert.ok(template, "the deterministic engine must supply the fixture evidence");
    const recommendations = Array.from({ length: 2_000 }, (_, id) => ({ ...template, key: `synthetic-recommendation-${id}`, target: { ...template.target, id: `synthetic-ad-${id}` } }));
    const scope = { accountId: "act_remote-fixture", campaignId: null, attributionKey: "7d_click", syncRunId: "synthetic-recommendations-v1", now: new Date() };
    assert.deepEqual(await persistRecommendationLifecycle(db, { ...scope, recommendations }), { created: 2_000, updated: 0, resolved: 0, active: 2_000 });
    const recommendation = await db.recommendation.findFirst();
    assert.deepEqual(await persistRecommendationLifecycle(db, { ...scope, now: new Date(scope.now.getTime() + 1_000), recommendations }), { created: 0, updated: 2_000, resolved: 0, active: 2_000 });
    const repeated = await db.recommendation.findUnique({ where: { id: recommendation.id } });
    assert.deepEqual(repeated.firstSeenAt, recommendation.firstSeenAt);
    assert.deepEqual(await persistRecommendationLifecycle(db, { ...scope, now: new Date(scope.now.getTime() + 2_000), recommendations: [] }), { created: 0, updated: 0, resolved: 2_000, active: 0 });
    console.log(JSON.stringify({ status: "passed", transport: "real libSQL over HTTPS", syntheticOnly: true, contacts: 3_000, opportunities: 1_000, recommendations: 2_000, repeatSyncPreservesIdentity: true, partialReadPreservesSnapshot: true, midbatchRollback: true, expiredLeaseRollback: true, recommendationLifecycle: true, durationMs: Date.now() - started }));
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const fixture = await startLibsqlSmokeServer();
  try {
    await runCommand(process.execPath, [fileURLToPath(new URL("./apply-turso-migrations.mjs", import.meta.url))], {
      env: { ...fixture.env, TURSO_MIGRATION_CONFIRM: "yes" }, logPath: join(fixture.evidenceDirectory, "migrations.log"),
    });
    await runCommand(process.execPath, ["--import=tsx", fileURLToPath(import.meta.url), "--fixture"], {
      env: fixture.env, logPath: join(fixture.evidenceDirectory, "remote-sync.log"),
    });
    console.log(`Remote sync smoke passed; evidence: ${fixture.evidenceDirectory}`);
  } finally {
    await stopLibsqlSmokeServer(fixture);
  }
}

await (process.argv[2] === "--fixture" ? checkRemoteSnapshot() : main());
