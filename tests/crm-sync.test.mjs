import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { loadHighLevelSettings } from "../lib/highlevel-config.ts";
import { HighLevelAlreadyRunningError, HighLevelMappingError, syncHighLevel } from "../lib/highlevel-sync.ts";
import { buildDashboardState } from "../lib/read-model.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904210000_pr06_recommendation_engine/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260905120000_pr07_ai_briefings/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260905133000_pr08_highlevel_attribution/migration.sql", import.meta.url),
];
const fixtures = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr08-"));
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

function config(overrides = {}) {
  return loadHighLevelSettings({
    HIGHLEVEL_TOKEN: "test-highlevel-token",
    HIGHLEVEL_LOCATION_ID: "location-1",
    HIGHLEVEL_API_VERSION: "v3",
    HIGHLEVEL_SYNC_ENABLED: "true",
    HIGHLEVEL_PIPELINE_ID: "pipeline-1",
    HIGHLEVEL_STAGE_LEAD_ID: "stage-lead",
    HIGHLEVEL_STAGE_CONTACTED_ID: "stage-contacted",
    HIGHLEVEL_STAGE_QUALIFIED_ID: "stage-qualified",
    HIGHLEVEL_STAGE_CALL_BOOKED_ID: "stage-booked",
    HIGHLEVEL_STAGE_CALL_ATTENDED_ID: "stage-attended",
    HIGHLEVEL_WON_STATUS: "won",
    HIGHLEVEL_LOST_STATUS: "lost",
    HIGHLEVEL_CURRENCY_CODE: "GBP",
    HIGHLEVEL_SYNC_LEASE_SECONDS: "900",
    ...overrides,
  });
}

function collection(items, extra = {}) {
  return { items, providerTotal: items.length, truncated: false, ...extra };
}

function environmentFor(settings) {
  return {
    HIGHLEVEL_TOKEN: settings.token ?? "",
    HIGHLEVEL_LOCATION_ID: settings.locationId ?? "",
    HIGHLEVEL_API_VERSION: settings.apiVersion,
    HIGHLEVEL_SYNC_ENABLED: settings.syncEnabled ? "true" : "false",
    HIGHLEVEL_PIPELINE_ID: settings.pipelineId ?? "",
    HIGHLEVEL_STAGE_LEAD_ID: settings.stageIds.lead ?? "",
    HIGHLEVEL_STAGE_CONTACTED_ID: settings.stageIds.contacted ?? "",
    HIGHLEVEL_STAGE_QUALIFIED_ID: settings.stageIds.qualified ?? "",
    HIGHLEVEL_STAGE_CALL_BOOKED_ID: settings.stageIds.callBooked ?? "",
    HIGHLEVEL_STAGE_CALL_ATTENDED_ID: settings.stageIds.callAttended ?? "",
    HIGHLEVEL_WON_STATUS: settings.wonStatus ?? "",
    HIGHLEVEL_LOST_STATUS: settings.lostStatus ?? "",
    HIGHLEVEL_META_AD_ID_FIELD_ID: settings.metaAdIdFieldId ?? "",
    HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: settings.metaCampaignIdFieldId ?? "",
    HIGHLEVEL_CURRENCY_CODE: settings.currencyCode ?? "",
  };
}

function client(overrides = {}) {
  return {
    getPipeline: async () => ({ id: "pipeline-1", locationId: "location-1", stages: [
      { id: "stage-lead" }, { id: "stage-contacted" }, { id: "stage-qualified" }, { id: "stage-booked" }, { id: "stage-attended" },
    ] }),
    listContacts: async () => collection([{
      id: "contact-1",
      locationId: "location-1",
      email: "lead@example.test",
      dateAdded: "2026-09-04T10:00:00.000Z",
      customFields: [{ id: "meta-ad-field", value: "ad-1" }],
      attribution: { utmSource: "meta", utmMedium: "paid_social" },
    }]),
    listOpportunities: async () => collection([{
      id: "opportunity-1",
      locationId: "location-1",
      pipelineId: "pipeline-1",
      pipelineStageId: "stage-qualified",
      status: "open",
      contactId: "contact-1",
      monetaryValue: "123.45",
    }]),
    ...overrides,
  };
}

test("persists a normalized HighLevel snapshot and reconnects a changed record without deleting history", async () => {
  const db = await createDatabase();
  const current = new Date("2026-09-04T12:00:00.000Z");
  const first = await syncHighLevel({ db, config: config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "meta-ad-field" }), client: client(), clock: () => current });
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(first.contactsWritten, 1);
  assert.equal(first.opportunitiesWritten, 1);
  const storedContact = await db.crmContact.findFirst({ where: { highLevelId: "contact-1", locationId: "location-1" } });
  const storedOpportunity = await db.crmOpportunity.findFirst({ where: { highLevelId: "opportunity-1", locationId: "location-1", pipelineId: "pipeline-1" } });
  assert.equal(storedContact.metaAdId, "ad-1");
  assert.equal(storedContact.attribution, '{"source":"meta","medium":"paid_social"}');
  assert.equal(storedOpportunity.semanticStage, "qualified");
  assert.equal(storedOpportunity.valueMajorUnits, 123.45);
  assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 1);

  const second = await syncHighLevel({
    db,
    config: config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "meta-ad-field" }),
    client: client({ listOpportunities: async () => collection([{ id: "opportunity-1", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-booked", status: "open", contactId: "contact-1", monetaryValue: "123.45" }]) }),
    clock: () => new Date("2026-09-05T12:00:00.000Z"),
  });
  assert.equal(second.status, "SUCCEEDED");
  assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 2);
  assert.equal(await db.crmContact.count(), 1);
  assert.equal(await db.crmOpportunity.count(), 1);
  assert.equal(await db.crmOpportunity.findFirst({ where: { highLevelId: "opportunity-1", locationId: "location-1", pipelineId: "pipeline-1" } }).then((row) => row.semanticStage), "callBooked");
});

test("preserves the last successful snapshot when a later provider read fails", async () => {
  const db = await createDatabase();
  const current = new Date("2026-09-04T12:00:00.000Z");
  const settings = config();
  const first = await syncHighLevel({ db, config: settings, client: client(), clock: () => current });
  await assert.rejects(() => syncHighLevel({ db, config: settings, client: client({ getPipeline: async () => { throw new Error("provider unavailable"); } }), clock: () => new Date("2026-09-05T12:00:00.000Z") }), /provider unavailable/);
  const stored = await db.crmContact.findFirst({ where: { highLevelId: "contact-1", locationId: "location-1" } });
  const latest = await db.crmSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
  assert.equal(stored.sourceSyncRunId, first.runId);
  assert.equal(latest.status, "FAILED");
  assert.match(latest.error, /provider unavailable/);
  assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 1);
});

test("does not call the provider when the explicit gate is disabled", async () => {
  const db = await createDatabase();
  let calls = 0;
  const result = await syncHighLevel({
    db,
    config: config({ HIGHLEVEL_SYNC_ENABLED: "false" }),
    client: {
      getPipeline: async () => { calls += 1; throw new Error("must not call"); },
      listContacts: async () => { calls += 1; return collection([]); },
      listOpportunities: async () => { calls += 1; return collection([]); },
    },
  });
  assert.equal(result.status, "DISABLED");
  assert.equal(calls, 0);
  assert.equal(await db.crmSyncRun.count(), 0);
});

test("rejects overlapping location leases and fails closed on a changed pipeline mapping", async () => {
  const db = await createDatabase();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const first = syncHighLevel({
    db,
    config: config(),
    client: client({ listContacts: async () => { await held; return collection([]); } }),
    clock: () => new Date("2026-09-04T12:00:00.000Z"),
  });
  while (await db.crmSyncRun.count() === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  await assert.rejects(() => syncHighLevel({ db, config: config(), client: client(), now: new Date("2026-09-04T12:00:00.000Z") }), HighLevelAlreadyRunningError);
  release();
  await first;

  await assert.rejects(() => syncHighLevel({ db, config: config(), client: client({ getPipeline: async () => ({ id: "pipeline-1", locationId: "location-1", stages: [{ id: "stage-lead" }] }) }) }), HighLevelMappingError);
  assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 1);
  assert.equal(await db.crmContact.count(), 0);
});

test("reads the matching CRM snapshot into the dashboard without replacing the Meta lead count", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "meta-ad-field" });
  const previous = Object.fromEntries([
    "META_AD_ACCOUNT_ID", "META_CAMPAIGN_ID", "HIGHLEVEL_TOKEN", "HIGHLEVEL_LOCATION_ID", "HIGHLEVEL_API_VERSION", "HIGHLEVEL_SYNC_ENABLED", "HIGHLEVEL_PIPELINE_ID",
    "HIGHLEVEL_STAGE_LEAD_ID", "HIGHLEVEL_STAGE_CONTACTED_ID", "HIGHLEVEL_STAGE_QUALIFIED_ID", "HIGHLEVEL_STAGE_CALL_BOOKED_ID", "HIGHLEVEL_STAGE_CALL_ATTENDED_ID", "HIGHLEVEL_WON_STATUS", "HIGHLEVEL_LOST_STATUS", "HIGHLEVEL_CURRENCY_CODE", "HIGHLEVEL_META_AD_ID_FIELD_ID",
  ].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    META_AD_ACCOUNT_ID: "act_dashboard",
    META_CAMPAIGN_ID: "",
    HIGHLEVEL_TOKEN: settings.token,
    HIGHLEVEL_LOCATION_ID: settings.locationId,
    HIGHLEVEL_API_VERSION: "v3",
    HIGHLEVEL_SYNC_ENABLED: "true",
    HIGHLEVEL_PIPELINE_ID: settings.pipelineId,
    HIGHLEVEL_STAGE_LEAD_ID: settings.stageIds.lead,
    HIGHLEVEL_STAGE_CONTACTED_ID: settings.stageIds.contacted,
    HIGHLEVEL_STAGE_QUALIFIED_ID: settings.stageIds.qualified,
    HIGHLEVEL_STAGE_CALL_BOOKED_ID: settings.stageIds.callBooked,
    HIGHLEVEL_STAGE_CALL_ATTENDED_ID: settings.stageIds.callAttended,
    HIGHLEVEL_WON_STATUS: settings.wonStatus,
    HIGHLEVEL_LOST_STATUS: settings.lostStatus,
    HIGHLEVEL_CURRENCY_CODE: "GBP",
    HIGHLEVEL_META_AD_ID_FIELD_ID: "meta-ad-field",
  });
  try {
    const metaRun = await db.syncRun.create({ data: {
      id: "meta-dashboard-run",
      accountId: "act_dashboard",
      trigger: "manual",
      status: "SUCCEEDED",
      attributionKey: "7d_click,1d_view",
      currencyCode: "GBP",
      timezoneName: "Europe/London",
      startedAt: new Date("2026-09-04T11:59:00.000Z"),
      finishedAt: now,
    } });
    await db.campaign.create({ data: { metaId: "campaign-1", name: "UKTL Leads", lastSeenSyncRunId: metaRun.id } });
    await db.ad.create({ data: { metaId: "ad-1", campaignMetaId: "campaign-1", name: "Local lead angle", lastSeenSyncRunId: metaRun.id } });
    await db.dailyInsight.createMany({ data: [
      { date: "2026-09-04", level: "account", entityId: "act_dashboard", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 10000, impressions: 1000, leads: 10, syncRunId: metaRun.id },
      { date: "2026-09-04", level: "campaign", entityId: "campaign-1", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 10000, impressions: 1000, leads: 10, syncRunId: metaRun.id },
      { date: "2026-09-04", level: "ad", entityId: "ad-1", attributionKey: "7d_click,1d_view", currencyCode: "GBP", spendMinorUnits: 10000, impressions: 1000, leads: 10, syncRunId: metaRun.id },
    ] });
    await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    const state = await buildDashboardState({ db, now });
    assert.equal(state.crm.status, "fresh");
    assert.equal(state.crm.counts.crmRecords, 1);
    assert.equal(state.crm.counts.metaLeads, 10);
    assert.equal(state.crm.counts.qualified, 1);
    assert.equal(state.funnel.leads, 10);
    assert.equal(state.funnel.qualified, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("surfaces skipped or capped provider rows as partial CRM data instead of a clean zero", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config();
  const previous = Object.fromEntries(Object.entries(environmentFor(settings)).map(([key]) => [key, process.env[key]]));
  Object.assign(process.env, environmentFor(settings));
  try {
    const result = await syncHighLevel({
      db,
      config: settings,
      client: client({
        listContacts: async () => collection([{ id: "contact-1", locationId: "location-1", dateAdded: "2026-09-04T10:00:00.000Z" }], { providerTotal: 2, truncated: true }),
        listOpportunities: async () => collection([]),
      }),
      clock: () => now,
    });
    assert.match(result.warning, /partial/);
    const run = await db.crmSyncRun.findUnique({ where: { id: result.runId } });
    assert.match(run.warning, /HIGHLEVEL_MAX_RECORDS/);
    const state = await buildDashboardState({ db, now });
    assert.equal(state.crm.status, "fresh");
    assert.equal(state.crm.dataQuality, "partial");
    assert.equal(state.crm.counts.crmRecords, 1);
    assert.match(state.crm.warnings.join(" "), /partial/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("keeps identical provider ids isolated by HighLevel location and pipeline", async () => {
  const db = await createDatabase();
  const firstSettings = config();
  const secondSettings = config({ HIGHLEVEL_LOCATION_ID: "location-2", HIGHLEVEL_PIPELINE_ID: "pipeline-2" });
  await syncHighLevel({ db, config: firstSettings, client: client(), clock: () => new Date("2026-09-04T12:00:00.000Z") });
  await syncHighLevel({
    db,
    config: secondSettings,
    client: client({
      getPipeline: async () => ({ id: "pipeline-2", locationId: "location-2", stages: [{ id: "stage-lead" }, { id: "stage-contacted" }, { id: "stage-qualified" }, { id: "stage-booked" }, { id: "stage-attended" }] }),
      listContacts: async () => collection([{ id: "contact-1", locationId: "location-2", dateAdded: "2026-09-04T10:00:00.000Z" }]),
      listOpportunities: async () => collection([{ id: "opportunity-1", locationId: "location-2", pipelineId: "pipeline-2", pipelineStageId: "stage-booked", status: "open", contactId: "contact-1", monetaryValue: "321.00" }]),
    }),
    clock: () => new Date("2026-09-04T12:01:00.000Z"),
  });
  assert.equal(await db.crmContact.count(), 2);
  assert.equal(await db.crmOpportunity.count(), 2);
  assert.equal((await db.crmContact.findFirst({ where: { locationId: "location-1" } })).locationId, "location-1");
  assert.equal((await db.crmContact.findFirst({ where: { locationId: "location-2" } })).locationId, "location-2");
  assert.equal((await db.crmOpportunity.findFirst({ where: { locationId: "location-1" } })).pipelineId, "pipeline-1");
  assert.equal((await db.crmOpportunity.findFirst({ where: { locationId: "location-2" } })).pipelineId, "pipeline-2");
});

test("redacts provider credentials before persisting a failed run", async () => {
  const db = await createDatabase();
  const settings = config();
  await assert.rejects(() => syncHighLevel({
    db,
    config: settings,
    client: client({ getPipeline: async () => { throw new Error("Bearer test-highlevel-token?access_token=test-highlevel-token"); } }),
  }), /Bearer \[REDACTED\]/);
  const run = await db.crmSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
  assert.equal(run.status, "FAILED");
  assert.equal(run.error.includes("test-highlevel-token"), false);
  assert.match(run.error, /Bearer \[REDACTED\]/);
});

test("marks stored CRM data stale and exposes an in-flight replacement run", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-05T12:00:00.000Z");
  const settings = config();
  const previous = Object.fromEntries(Object.entries(environmentFor(settings)).map(([key]) => [key, process.env[key]]));
  const previousAccount = process.env.META_AD_ACCOUNT_ID;
  Object.assign(process.env, environmentFor(settings), { META_AD_ACCOUNT_ID: "" });
  try {
    await db.crmSyncRun.create({ data: {
      id: "crm-stale-run",
      locationId: "location-1",
      pipelineId: "pipeline-1",
      apiVersion: "v3",
      mappingHash: settings.mappingHash,
      status: "SUCCEEDED",
      trigger: "cron",
      startedAt: new Date("2026-09-04T07:00:00.000Z"),
      finishedAt: new Date("2026-09-04T07:00:00.000Z"),
    } });
    const stale = await buildDashboardState({ db, now });
    assert.equal(stale.crm.status, "stale");
    assert.equal(stale.crm.counts.crmRecords, 0);

    await db.crmSyncRun.create({ data: {
      id: "crm-running-run",
      locationId: "location-1",
      pipelineId: "pipeline-1",
      apiVersion: "v3",
      mappingHash: settings.mappingHash,
      status: "RUNNING",
      trigger: "cron",
      startedAt: new Date("2026-09-05T11:59:00.000Z"),
    } });
    const running = await buildDashboardState({ db, now });
    assert.equal(running.crm.status, "running");
    assert.equal(running.crm.counts.crmRecords, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousAccount === undefined) delete process.env.META_AD_ACCOUNT_ID;
    else process.env.META_AD_ACCOUNT_ID = previousAccount;
  }
});
