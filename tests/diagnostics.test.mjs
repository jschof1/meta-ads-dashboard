import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemDiagnostics, CURRENT_SCHEMA_MIGRATION, EXPECTED_MIGRATIONS, STALE_AFTER_MS } from "../lib/system-diagnostics.ts";
import { loadHighLevelSettings } from "../lib/highlevel-config.ts";
import { EXPECTED_MIGRATION_CHECKSUMS } from "../lib/migration-manifest.ts";

const now = new Date("2026-09-05T12:00:00.000Z");

function environment(overrides = {}) {
  return {
    DASHBOARD_PASSWORD: "diagnostics-password",
    AUTH_SECRET: "a".repeat(32),
    CRON_SECRET: "b".repeat(32),
    DATABASE_URL: "file:diagnostics.db",
    META_MARKETING_TOKEN: "meta-secret-must-never-be-returned",
    META_AD_ACCOUNT_ID: "act_diagnostics",
    META_CAMPAIGN_ID: "campaign-diagnostics",
    META_WRITES_ENABLED: "false",
    ANTHROPIC_API_KEY: "anthropic-secret-must-never-be-returned",
    HIGHLEVEL_TOKEN: "highlevel-secret-must-never-be-returned",
    HIGHLEVEL_LOCATION_ID: "location-diagnostics",
    HIGHLEVEL_PIPELINE_ID: "pipeline-diagnostics",
    HIGHLEVEL_SYNC_ENABLED: "true",
    HIGHLEVEL_STAGE_LEAD_ID: "stage-lead",
    HIGHLEVEL_STAGE_CONTACTED_ID: "stage-contacted",
    HIGHLEVEL_STAGE_QUALIFIED_ID: "stage-qualified",
    HIGHLEVEL_STAGE_CALL_BOOKED_ID: "stage-booked",
    HIGHLEVEL_STAGE_CALL_ATTENDED_ID: "stage-attended",
    HIGHLEVEL_WON_STATUS: "won",
    HIGHLEVEL_LOST_STATUS: "lost",
    HIGHLEVEL_CURRENCY_CODE: "GBP",
    ...overrides,
  };
}

function database({
  metaAttempt = { status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null },
  metaSuccess = { id: "sync-current", status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null },
  crmAttempt = { status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null },
  crmSuccess = { status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null },
  ai = { generatedAt: now, sourceSyncRunId: "sync-current" },
  migrations = EXPECTED_MIGRATIONS.map((migration_name) => ({
    migration_name,
    checksum: EXPECTED_MIGRATION_CHECKSUMS[migration_name],
    finished_at: now,
    rolled_back_at: null,
    applied_steps_count: 1,
  })),
} = {}) {
  return {
    $queryRaw: async () => [{ "1": 1 }],
    $queryRawUnsafe: async () => migrations,
    syncRun: {
      findFirst: async (args) => {
        const row = args.where.status === "SUCCEEDED" ? metaSuccess : metaAttempt;
        return row == null ? null : Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key]]));
      },
    },
    aiBriefing: {
      findFirst: async () => ai,
    },
    crmSyncRun: {
      findFirst: async (args) => {
        const row = args.where.status === "SUCCEEDED" ? crmSuccess : crmAttempt;
        return row == null ? null : Object.fromEntries(Object.keys(args.select).map((key) => [key, row[key]]));
      },
    },
  };
}

test("reports safe database, migration, provider and freshness state without secret values", async () => {
  const diagnostics = await buildSystemDiagnostics({ db: database(), env: environment(), now });

  assert.equal(diagnostics.database.status, "ok");
  assert.equal(diagnostics.database.configuration, "configured");
  assert.equal(diagnostics.migrations.status, "ok");
  assert.equal(diagnostics.migrations.latestApplied, CURRENT_SCHEMA_MIGRATION);
  assert.equal(diagnostics.meta.status, "ok");
  assert.equal(diagnostics.meta.configuration, "configured");
  assert.equal(diagnostics.meta.sync.status, "ok");
  assert.equal(diagnostics.meta.actionGate.status, "disabled");
  assert.equal(diagnostics.meta.actionGate.writesEnabled, false);
  assert.equal(diagnostics.ai.status, "ok");
  assert.equal(diagnostics.ai.currentSource, true);
  assert.equal(diagnostics.highLevel.status, "ok");
  assert.equal(diagnostics.highLevel.providerReady, true);
  assert.equal(diagnostics.highLevel.mappingReady, true);
  assert.equal(diagnostics.highLevel.revenueReady, true);
  assert.equal(JSON.stringify(diagnostics).includes("meta-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("anthropic-secret"), false);
  assert.equal(JSON.stringify(diagnostics).includes("highlevel-secret"), false);
});

test("marks a failed or old stored sync as actionable instead of treating it as zero data", async () => {
  const old = new Date("2026-09-03T00:00:00.000Z");
  const diagnostics = await buildSystemDiagnostics({
    db: database({
      metaAttempt: { status: "FAILED", startedAt: now, finishedAt: now, error: "provider detail" },
      metaSuccess: { id: "sync-old", status: "SUCCEEDED", startedAt: old, finishedAt: old, error: null },
    }),
    env: environment(),
    now,
  });

  assert.equal(diagnostics.meta.sync.status, "failed");
  assert.equal(diagnostics.meta.sync.lastFailureRecorded, true);
  assert.equal(diagnostics.meta.sync.stale, true);
  assert.equal(diagnostics.database.sync.status, "failed");
  assert.equal(JSON.stringify(diagnostics).includes("provider detail"), false);
});

test("reports a generic warning for successful Meta syncs without leaking stored provider details", async () => {
  const detail = "Provider result unavailable: https://provider.invalid/?access_token=private-provider-token";
  const success = { id: "sync-current", status: "SUCCEEDED", startedAt: now, finishedAt: now, error: detail, warning: detail };
  const diagnostics = await buildSystemDiagnostics({ db: database({ metaAttempt: success, metaSuccess: success }), env: environment(), now });

  assert.equal(diagnostics.meta.status, "warning");
  assert.equal(diagnostics.meta.sync.status, "warning");
  assert.equal(diagnostics.database.sync.status, "warning");
  assert.equal(diagnostics.meta.sync.latestAttemptStatus, "SUCCEEDED");
  assert.equal(diagnostics.meta.sync.stale, false);
  const payload = JSON.stringify(diagnostics);
  for (const sensitive of [detail, "provider.invalid", "private-provider-token", "access_token"]) {
    assert.equal(payload.includes(sensitive), false);
  }
});

test("empty Meta warnings remain healthy and warnings do not mask failed or stale syncs", async () => {
  for (const warning of [null, "", " \n\t"]) {
    const success = { id: "sync-current", status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null, warning };
    const diagnostics = await buildSystemDiagnostics({ db: database({ metaAttempt: success, metaSuccess: success }), env: environment(), now });
    assert.equal(diagnostics.meta.status, "ok");
  }
  const success = { id: "sync-current", status: "SUCCEEDED", startedAt: now, finishedAt: now, error: null, warning: "private warning" };
  const stale = await buildSystemDiagnostics({ db: database({ metaAttempt: success, metaSuccess: success }), env: environment(), now: new Date(now.getTime() + STALE_AFTER_MS + 1) });
  assert.equal(stale.meta.status, "stale");
  const failed = await buildSystemDiagnostics({ db: database({ metaAttempt: { ...success, status: "FAILED" }, metaSuccess: success }), env: environment(), now });
  assert.equal(failed.meta.status, "failed");
});

test("reports warning-bearing CRM success safely and preserves failure and staleness precedence", async () => {
  const detail = "Legacy partial snapshot: https://provider.invalid/?access_token=private-crm-token";
  const success = { status: "SUCCEEDED", startedAt: now, finishedAt: now, error: detail, warning: detail };
  for (const [attemptStatus, age, expected] of [["SUCCEEDED", 0, "warning"], ["FAILED", 0, "failed"], ["SUCCEEDED", STALE_AFTER_MS + 1, "stale"]]) {
    const diagnostics = await buildSystemDiagnostics({
      db: database({ crmAttempt: { ...success, status: attemptStatus }, crmSuccess: success }),
      env: environment(),
      now: new Date(now.getTime() + age),
    });
    assert.equal(diagnostics.highLevel.status, expected);
    assert.equal(diagnostics.highLevel.sync.status, expected);
    assert.equal(diagnostics.highLevel.sync.latestAttemptStatus, attemptStatus);
    assert.equal(diagnostics.highLevel.sync.lastSuccessfulSyncAt, now.toISOString());
    const payload = JSON.stringify(diagnostics);
    for (const sensitive of [detail, "provider.invalid", "private-crm-token", "access_token"]) {
      assert.equal(payload.includes(sensitive), false);
    }
  }
});

test("AI expires with its Meta source even when the latest successful run ID is unchanged", async () => {
  for (const [age, status, currentSource] of [[STALE_AFTER_MS, "ok", true], [STALE_AFTER_MS + 1, "stale", false]]) {
    const diagnostics = await buildSystemDiagnostics({ db: database(), env: environment(), now: new Date(now.getTime() + age) });
    assert.equal(diagnostics.meta.status, status);
    assert.equal(diagnostics.ai.status, status);
    assert.equal(diagnostics.ai.currentSource, currentSource);
    assert.equal(diagnostics.ai.lastGeneratedAt, now.toISOString());
  }
});

test("AI source freshness stays unknown when the source cannot be read or dated", async () => {
  const unavailable = database();
  unavailable.syncRun.findFirst = async () => { throw new Error("private provider error"); };
  const undated = database({ metaSuccess: { id: "sync-current", status: "SUCCEEDED", startedAt: now, finishedAt: null, error: null } });
  for (const db of [unavailable, undated]) {
    const diagnostics = await buildSystemDiagnostics({ db, env: environment(), now });
    assert.equal(diagnostics.ai.status, "unknown");
    assert.equal(diagnostics.ai.currentSource, null);
    assert.equal(JSON.stringify(diagnostics).includes("private provider error"), false);
  }
});

test("reports optional and disabled integrations without making provider calls", async () => {
  let calls = 0;
  const db = database();
  db.syncRun.findFirst = async () => { calls += 1; throw new Error("should not query without account scope"); };
  db.crmSyncRun.findFirst = async () => { calls += 1; throw new Error("should not query without CRM scope"); };
  db.aiBriefing.findFirst = async () => { calls += 1; throw new Error("should not query without account scope"); };
  const diagnostics = await buildSystemDiagnostics({
    db,
    env: environment({
      META_MARKETING_TOKEN: "",
      META_AD_ACCOUNT_ID: "",
      ANTHROPIC_API_KEY: "",
      HIGHLEVEL_TOKEN: "",
      HIGHLEVEL_LOCATION_ID: "",
      HIGHLEVEL_PIPELINE_ID: "",
      HIGHLEVEL_STAGE_LEAD_ID: "",
      HIGHLEVEL_STAGE_CONTACTED_ID: "",
      HIGHLEVEL_STAGE_QUALIFIED_ID: "",
      HIGHLEVEL_STAGE_CALL_BOOKED_ID: "",
      HIGHLEVEL_STAGE_CALL_ATTENDED_ID: "",
      HIGHLEVEL_WON_STATUS: "",
      HIGHLEVEL_LOST_STATUS: "",
      HIGHLEVEL_CURRENCY_CODE: "",
    }),
    now,
  });

  assert.equal(diagnostics.meta.status, "not_configured");
  assert.equal(diagnostics.ai.status, "not_configured");
  assert.equal(diagnostics.highLevel.status, "not_configured");
  assert.equal(diagnostics.meta.actionGate.status, "disabled");
  assert.equal(calls, 0);
});

test("fails closed to redacted unknown states when the database probe is unavailable", async () => {
  const db = database();
  db.$queryRaw = async () => { throw new Error("database credential or provider detail"); };
  const diagnostics = await buildSystemDiagnostics({ db, env: environment(), now });

  assert.equal(diagnostics.database.status, "failed");
  assert.equal(diagnostics.database.configuration, "configured");
  assert.equal(diagnostics.migrations.status, "unknown");
  assert.equal(diagnostics.meta.sync.status, "unknown");
  assert.equal(diagnostics.ai.status, "unknown");
  assert.equal(diagnostics.highLevel.sync.status, "unknown");
  assert.equal(JSON.stringify(diagnostics).includes("database credential"), false);
  assert.equal(JSON.stringify(diagnostics).includes("meta-secret"), false);
});

test("does not mark a partial or out-of-order migration ledger as healthy", async () => {
  const diagnostics = await buildSystemDiagnostics({
    db: database({ migrations: [{
      migration_name: CURRENT_SCHEMA_MIGRATION,
      checksum: EXPECTED_MIGRATION_CHECKSUMS[CURRENT_SCHEMA_MIGRATION],
      finished_at: now,
      rolled_back_at: null,
      applied_steps_count: 1,
    }] }),
    env: environment(),
    now,
  });

  assert.equal(diagnostics.migrations.status, "warning");
  assert.equal(diagnostics.migrations.appliedCount, 1);
  assert.equal(diagnostics.migrations.failedCount, 0);
});

test("marks a checksum-corrupted migration ledger as failed", async () => {
  const migrations = EXPECTED_MIGRATIONS.map((migration_name) => ({
    migration_name,
    checksum: EXPECTED_MIGRATION_CHECKSUMS[migration_name],
    finished_at: now,
    rolled_back_at: null,
    applied_steps_count: 1,
  }));
  migrations[2].checksum = "0".repeat(64);
  const diagnostics = await buildSystemDiagnostics({ db: database({ migrations }), env: environment(), now });

  assert.equal(diagnostics.migrations.status, "failed");
  assert.equal(diagnostics.migrations.failedCount, 1);
});

test("does not report an old HighLevel mapping snapshot as current", async () => {
  const env = environment();
  const currentMappingHash = loadHighLevelSettings(env).mappingHash;
  const db = database();
  const queriedMappings = [];
  db.crmSyncRun.findFirst = async (args) => {
    queriedMappings.push(args.where.mappingHash);
    return args.where.mappingHash === currentMappingHash ? null : {
      status: "SUCCEEDED",
      startedAt: now,
      finishedAt: now,
      error: null,
    };
  };
  const diagnostics = await buildSystemDiagnostics({ db, env, now });

  assert.deepEqual(queriedMappings, [currentMappingHash, currentMappingHash]);
  assert.equal(diagnostics.highLevel.status, "warning");
  assert.equal(diagnostics.highLevel.sync.status, "warning");
});
