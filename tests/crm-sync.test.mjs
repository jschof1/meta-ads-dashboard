import test, { afterEach, mock } from "node:test";
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
  mock.restoreAll();
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await fixture.db.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("writes a large CRM snapshot with only the short lease-acquisition Prisma transaction", async () => {
  const db = await createDatabase();
  const transaction = db.$transaction.bind(db);
  const spy = mock.fn((...args) => transaction(...args));
  db.$transaction = spy;
  const contacts = Array.from({ length: 1_000 }, (_, i) => ({ id: `contact-${i}`, locationId: "location-1", dateAdded: "2026-09-04T10:00:00.000Z" }));
  const opportunities = contacts.map((contact, i) => ({ id: `opportunity-${i}`, contactId: contact.id, locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-qualified", status: "open", monetaryValue: "12.34" }));
  const result = await syncHighLevel({ db, config: config(), client: client({ listContacts: async () => collection(contacts), listOpportunities: async () => collection(opportunities) }), clock: () => new Date("2026-09-04T12:00:00.000Z") });
  assert.equal(spy.mock.callCount(), 1);
  assert.equal(result.contactsWritten, 1_000);
  assert.equal(result.opportunitiesWritten, 1_000);
  assert.equal(await db.crmContact.count({ where: { sourceSyncRunId: result.runId } }), 1_000);
  assert.equal(await db.crmOpportunity.count({ where: { sourceSyncRunId: result.runId } }), 1_000);
  assert.equal((await db.crmSyncRun.findUnique({ where: { id: result.runId } })).status, "SUCCEEDED");
});

for (const failure of ["opportunity write", "expired lease", "replaced owner"]) {
  test(`CRM ${failure} rolls back contact updates and retains the last successful snapshot`, async () => {
    const db = await createDatabase();
    const settings = config();
    const first = await syncHighLevel({ db, config: settings, client: client(), clock: () => new Date("2026-09-04T12:00:00.000Z") });
    const beforeContacts = await db.crmContact.findMany();
    const beforeOpportunities = await db.crmOpportunity.findMany();
    if (failure === "opportunity write") {
      await db.$executeRawUnsafe(`CREATE TRIGGER fail_opportunity BEFORE INSERT ON "CrmOpportunity" BEGIN SELECT RAISE(ABORT, 'opportunity batch failure'); END`);
    }
    const ordinary = client();
    const source = client({
      listContacts: async () => collection([{ id: "contact-1", locationId: "location-1", dateAdded: "2026-09-05T10:00:00.000Z", attribution: { utmSource: "changed" } }, { id: "new-contact", locationId: "location-1" }]),
      listOpportunities: async () => {
        if (failure === "expired lease") await db.crmSyncRun.updateMany({ where: { status: "RUNNING" }, data: { lockExpiresAt: new Date(0) } });
        if (failure === "replaced owner") await db.crmSyncRun.updateMany({ where: { status: "RUNNING" }, data: { lockOwner: "other-worker" } });
        return ordinary.listOpportunities();
      },
    });
    await assert.rejects(syncHighLevel({ db, config: settings, client: source, clock: () => new Date("2026-09-05T12:00:00.000Z") }), /opportunity batch failure|lease was lost/);
    assert.deepEqual(await db.crmContact.findMany(), beforeContacts);
    assert.deepEqual(await db.crmOpportunity.findMany(), beforeOpportunities);
    assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 1);
    assert.equal((await db.crmSyncRun.findUnique({ where: { id: first.runId } })).status, "SUCCEEDED");
    if (failure === "replaced owner") assert.equal((await db.crmSyncRun.findFirst({ where: { status: "RUNNING" } })).lockOwner, "other-worker");
    else assert.equal(await db.crmSyncRun.count({ where: { status: "FAILED" } }), 1);
  });
}

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

test("a CRM batch committed during a dashboard read cannot become complete zero outcomes", async () => {
  const db = await createDatabase();
  const settings = config();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const overrides = { ...environmentFor(settings), META_AD_ACCOUNT_ID: "", META_CAMPAIGN_ID: "", ANTHROPIC_API_KEY: "" };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  let replacement;
  let rowRead;
  try {
    const first = await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    assert.equal((await buildDashboardState({ db, now })).crm.counts.qualified, 1);
    rowRead = db.crmContact.findMany;
    db.crmContact.findMany = async (...args) => {
      // Commit the real replacement batch after run selection but before the
      // selected run's contacts are read. No timing sleeps or provider calls.
      replacement ??= syncHighLevel({
        db,
        config: settings,
        client: client(),
        clock: () => new Date(now.getTime() + 60_000),
      });
      await replacement;
      return rowRead.apply(db.crmContact, args);
    };
    const state = await buildDashboardState({ db, now: new Date(now.getTime() + 120_000) });
    assert.ok(replacement, "the replacement must commit while the read is in flight");
    const committed = await replacement;
    assert.notEqual(committed.runId, first.runId);
    assert.equal(committed.status, "SUCCEEDED");
    assert.equal(committed.contactsWritten, 1);
    assert.equal(committed.opportunitiesWritten, 1);
    assert.equal(await db.crmContact.count({ where: { sourceSyncRunId: committed.runId } }), 1);

    // Both snapshots contain the same one qualified contact. Accept either a
    // consistent snapshot (including a retry) or explicit withheld metrics,
    // without prescribing a retry count, status label or internal strategy.
    if (state.crm.counts.crmRecords === null) {
      assert.notEqual(state.crm.dataQuality, "complete");
      for (const [key, value] of Object.entries(state.crm.counts)) {
        if (key !== "metaLeads") assert.equal(value, null, key);
      }
      for (const value of Object.values(state.crm.rates)) assert.equal(value, null);
      for (const value of Object.values(state.crm.costs)) assert.equal(value, null);
      assert.equal(state.crm.revenue.minorUnits, null);
      assert.equal(state.funnel.qualified, null);
    } else {
      assert.equal(state.crm.counts.crmRecords, 1, "an overwritten snapshot is not an empty cohort");
      assert.equal(state.crm.counts.qualified, 1, "contact and opportunity reads must belong to one snapshot");
      assert.equal(state.funnel.qualified, 1);
    }
  } finally {
    if (rowRead) db.crmContact.findMany = rowRead;
    if (replacement) await replacement.catch(() => {});
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("repeated CRM batch commits bound dashboard retries instead of returning mixed data", async () => {
  const db = await createDatabase();
  const settings = config();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const overrides = { ...environmentFor(settings), META_AD_ACCOUNT_ID: "", META_CAMPAIGN_ID: "", ANTHROPIC_API_KEY: "" };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const findContacts = db.crmContact.findMany;
  let commits = 0;
  try {
    await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    db.crmContact.findMany = async (...args) => {
      // A safety cap detects an unbounded retry loop without a timing race.
      // Do not require the reader to use a particular number of retries.
      assert.ok(commits < 10, "dashboard must bound its attempts");
      commits += 1;
      const result = await syncHighLevel({ db, config: settings, client: client(), clock: () => new Date(now.getTime() + commits * 60_000) });
      assert.equal(result.status, "SUCCEEDED");
      return findContacts.apply(db.crmContact, args);
    };
    await assert.rejects(
      buildDashboardState({ db, now: new Date(now.getTime() + 15 * 60_000) }),
      /snapshot.*(?:changed|consistent)|retry/i,
    );
    assert.ok(commits >= 2, "exercise continued churn, not just a single replacement");
    assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), commits + 1);
    db.crmContact.findMany = findContacts;
    const stable = await buildDashboardState({ db, now: new Date(now.getTime() + 15 * 60_000) });
    assert.equal(stable.crm.counts.crmRecords, 1);
    assert.equal(stable.crm.counts.qualified, 1);
  } finally {
    db.crmContact.findMany = findContacts;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("rejects capped snapshots, preserving the complete snapshot and marking the latest attempt failed", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config();
  const previous = Object.fromEntries(Object.entries(environmentFor(settings)).map(([key]) => [key, process.env[key]]));
  Object.assign(process.env, environmentFor(settings));
  try {
    const first = await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    const later = new Date(now.getTime() + 60_000);
    await assert.rejects(() => syncHighLevel({
      db,
      config: settings,
      client: client({
        listContacts: async () => collection([{ id: "contact-1", locationId: "location-1", dateAdded: "2026-09-04T10:00:00.000Z" }], { providerTotal: 2, truncated: true }),
        listOpportunities: async () => collection([]),
      }),
      clock: () => later,
    }), /incomplete snapshot/);
    const run = await db.crmSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
    assert.equal(run.status, "FAILED");
    assert.match(run.error, /HIGHLEVEL_MAX_RECORDS/);
    assert.equal((await db.crmContact.findFirst()).sourceSyncRunId, first.runId);
    assert.equal((await db.crmOpportunity.findFirst()).sourceSyncRunId, first.runId);
    const state = await buildDashboardState({ db, now: later });
    assert.equal(state.crm.status, "failed");
    assert.equal(state.crm.dataQuality, "complete");
    assert.equal(state.crm.counts.crmRecords, 1);
    assert.equal(state.crm.counts.qualified, 1);
    assert.match(state.crm.warnings.join(" "), /latest HighLevel attempt failed/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("never turns an incomplete first read into zero CRM outcomes", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config();
  const previous = Object.fromEntries(Object.keys(environmentFor(settings)).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environmentFor(settings));
  try {
    const contact = { id: "contact-1", locationId: "location-1", dateAdded: "2026-09-04T10:00:00.000Z" };
    for (const badCollection of [
      collection([], { providerTotal: 2 }),
      collection([{ ...contact, locationId: "wrong-location" }]),
      collection([contact, contact]),
      { items: null, providerTotal: null, truncated: false },
    ]) {
      await assert.rejects(() => syncHighLevel({ db, config: settings, client: client({ listContacts: async () => badCollection }), clock: () => now }), /invalid collection|incomplete snapshot/);
    }
    await assert.rejects(() => syncHighLevel({ db, config: settings, client: client({ listOpportunities: async () => collection([], { truncated: true }) }), clock: () => now }), /incomplete snapshot/);
    assert.equal(await db.crmContact.count(), 0);
    assert.equal(await db.crmOpportunity.count(), 0);
    assert.equal(await db.crmSyncRun.count({ where: { status: "SUCCEEDED" } }), 0);
    const state = await buildDashboardState({ db, now });
    assert.equal(state.crm.status, "failed");
    assert.equal(state.crm.counts.crmRecords, null);
    assert.equal(state.crm.counts.qualified, null);
    assert.equal(state.crm.counts.wonCustomers, null);
    assert.equal(state.funnel.qualified, null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("withholds all CRM aggregates from legacy partial snapshots without hiding Meta leads", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config();
  const previous = Object.fromEntries(Object.keys(environmentFor(settings)).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environmentFor(settings));
  try {
    const result = await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    await db.crmSyncRun.update({ where: { id: result.runId }, data: { warning: "Provider rows were capped; stored snapshot is partial." } });
    const state = await buildDashboardState({ db, now });
    assert.equal(state.crm.dataQuality, "partial");
    for (const [key, value] of Object.entries(state.crm.counts)) {
      if (key !== "metaLeads") assert.equal(value, null, key);
    }
    for (const value of Object.values(state.crm.rates)) assert.equal(value, null);
    for (const value of Object.values(state.crm.costs)) assert.equal(value, null);
    assert.equal(state.crm.revenue.minorUnits, null);
    assert.equal(state.crm.revenue.roas, null);
    assert.deepEqual(state.crm.performanceByEntity, []);
    assert.equal(state.crm.counts.metaLeads, state.funnel.leads);
    assert.equal(state.funnel.qualified, null);
    assert.match(state.crm.warnings.join(" "), /withheld/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("revenue-only uncertainty preserves complete CRM counts but cannot override a partial-read warning", async () => {
  const db = await createDatabase();
  const now = new Date("2026-09-04T12:00:00.000Z");
  const settings = config({ HIGHLEVEL_CURRENCY_CODE: "" });
  const previous = Object.fromEntries(Object.keys(environmentFor(settings)).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environmentFor(settings));
  try {
    const result = await syncHighLevel({ db, config: settings, client: client(), clock: () => now });
    const state = await buildDashboardState({ db, now });
    assert.equal(state.crm.counts.crmRecords, 1);
    assert.equal(state.crm.counts.qualified, 1);
    assert.equal(state.crm.revenue.minorUnits, null);
    assert.equal(state.crm.revenue.roas, null);
    const run = await db.crmSyncRun.findUnique({ where: { id: result.runId } });
    assert.match(run.warning, /CURRENCY_CODE/);
    await db.crmSyncRun.update({ where: { id: result.runId }, data: { warning: `${run.warning} 1 won opportunity row(s) have no valid monetary value; attributed revenue remains incomplete.` } });
    assert.equal((await buildDashboardState({ db, now })).crm.counts.crmRecords, 1);
    await db.crmSyncRun.update({ where: { id: result.runId }, data: { warning: `${run.warning} The stored snapshot is partial.` } });
    assert.equal((await buildDashboardState({ db, now })).crm.counts.crmRecords, null);
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
