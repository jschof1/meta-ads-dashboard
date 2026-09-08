import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { getSafeEnvironmentStatus, type SafeEnvironmentStatus } from "@/lib/env";
import { loadHighLevelSettings, type HighLevelConfigStatus } from "@/lib/highlevel-config";
import { loadMetaActionConfig, metaActionGate } from "@/lib/meta-actions";
import type { MetaActionGate } from "@/lib/meta-action-types";
import {
  CURRENT_SCHEMA_MIGRATION,
  EXPECTED_MIGRATIONS,
  EXPECTED_MIGRATION_CHECKSUMS,
} from "@/lib/migration-manifest";

export { CURRENT_SCHEMA_MIGRATION, EXPECTED_MIGRATIONS } from "@/lib/migration-manifest";
export const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;

export type DiagnosticEnvironment = Record<string, string | undefined>;
export type DiagnosticStatus = "ok" | "warning" | "failed" | "disabled" | "not_configured" | "misconfigured" | "stale" | "unknown";

type SyncDiagnostic = {
  status: DiagnosticStatus;
  latestAttemptStatus: string | null;
  latestAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastFailureRecorded: boolean;
  stale: boolean | null;
};

export type SystemDiagnostics = {
  schemaVersion: 1;
  checkedAt: string;
  configuration: SafeEnvironmentStatus;
  database: {
    status: "ok" | "failed";
    configuration: SafeEnvironmentStatus["database"];
    latencyMs: number | null;
    sync: SyncDiagnostic;
  };
  migrations: {
    status: "ok" | "warning" | "failed" | "unknown";
    currentMigration: string;
    latestApplied: string | null;
    appliedCount: number | null;
    failedCount: number | null;
  };
  meta: {
    status: DiagnosticStatus;
    configuration: "configured" | "not_configured";
    graphVersion: string;
    campaignScoped: boolean;
    actionGate: MetaActionGate;
    sync: SyncDiagnostic;
  };
  ai: {
    status: DiagnosticStatus;
    configuration: "configured" | "not_configured";
    lastGeneratedAt: string | null;
    currentSource: boolean | null;
  };
  highLevel: {
    status: DiagnosticStatus;
    configuration: HighLevelConfigStatus;
    providerReady: boolean;
    mappingReady: boolean;
    revenueReady: boolean;
    issues: string[];
    sync: SyncDiagnostic;
  };
};

type QueryResult<T> = { ok: true; value: T } | { ok: false };
type SyncRow = {
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  warning?: string | null;
};
type AiRow = {
  generatedAt: Date;
  sourceSyncRunId: string;
};
type MigrationRow = {
  migration_name: unknown;
  checksum: unknown;
  finished_at: unknown;
  rolled_back_at: unknown;
  applied_steps_count: unknown;
};

async function safeQuery<T>(query: () => Promise<T>): Promise<QueryResult<T>> {
  try {
    return { ok: true, value: await query() };
  } catch {
    return { ok: false };
  }
}

function iso(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function configuredAccountId(env: DiagnosticEnvironment): string | null {
  const value = env.META_AD_ACCOUNT_ID?.trim();
  if (!value) return null;
  return value.startsWith("act_") ? value : `act_${value}`;
}

function configuredCampaignId(env: DiagnosticEnvironment): string | null {
  const value = env.META_CAMPAIGN_ID?.trim();
  return value || null;
}

function configuredAttributionKey(env: DiagnosticEnvironment): string {
  const values = env.META_ATTRIBUTION_WINDOWS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (values && values.length > 0 ? values : ["7d_click", "1d_view"]).join(",");
}

function syncDiagnosticFromRows(
  latestAttempt: SyncRow | null,
  latestSuccess: SyncRow | null,
  now: Date,
  queryAvailable: boolean,
): SyncDiagnostic {
  if (!queryAvailable) {
    return {
      status: "unknown",
      latestAttemptStatus: null,
      latestAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastFailureRecorded: false,
      stale: null,
    };
  }
  const latestAttemptAt = iso(latestAttempt?.finishedAt ?? latestAttempt?.startedAt);
  const lastSuccessfulSyncAt = iso(latestSuccess?.finishedAt);
  const successTime = latestSuccess?.finishedAt?.getTime();
  const stale = latestSuccess == null
    ? null
    : successTime != null && Number.isFinite(successTime)
      ? now.getTime() - successTime > STALE_AFTER_MS
      : null;
  const status: DiagnosticStatus = latestAttempt?.status === "RUNNING"
    ? "warning"
    : latestAttempt?.status === "FAILED"
      ? "failed"
      : latestSuccess == null
        ? "warning"
        : stale == null
          ? "unknown"
          : stale
            ? "stale"
            : latestSuccess.warning?.trim()
              ? "warning"
              : "ok";
  return {
    status,
    latestAttemptStatus: latestAttempt?.status ?? null,
    latestAttemptAt,
    lastSuccessfulSyncAt,
    lastFailureRecorded: latestAttempt?.status === "FAILED" && Boolean(latestAttempt.error),
    stale,
  };
}

async function readMetaSync(
  db: PrismaClient,
  accountId: string | null,
  campaignId: string | null,
  attributionKey: string,
  now: Date,
): Promise<{ diagnostic: SyncDiagnostic; latestSuccessId: string | null; available: boolean }> {
  if (!accountId) {
    return {
      diagnostic: notConfiguredSync(),
      latestSuccessId: null,
      available: true,
    };
  }
  const where = { accountId, campaignId, attributionKey };
  const [attempt, success] = await Promise.all([
    safeQuery(() => db.syncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, error: true, warning: true } })),
    safeQuery(() => db.syncRun.findFirst({ where: { ...where, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, error: true, warning: true, id: true } })),
  ]);
  const latestSuccess = success.ok ? success.value : null;
  return {
    diagnostic: syncDiagnosticFromRows(attempt.ok ? attempt.value : null, latestSuccess, now, attempt.ok && success.ok),
    latestSuccessId: success.ok ? (latestSuccess as (SyncRow & { id: string }) | null)?.id ?? null : null,
    available: attempt.ok && success.ok,
  };
}

async function readCrmSync(
  db: PrismaClient,
  locationId: string | null,
  pipelineId: string | null,
  mappingHash: string | null,
  now: Date,
): Promise<SyncDiagnostic> {
  if (!locationId || !pipelineId || !mappingHash) return notConfiguredSync();
  const where = { locationId, pipelineId, mappingHash };
  const [attempt, success] = await Promise.all([
    safeQuery(() => db.crmSyncRun.findFirst({ where, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, error: true, warning: true } })),
    safeQuery(() => db.crmSyncRun.findFirst({ where: { ...where, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true, error: true, warning: true } })),
  ]);
  return syncDiagnosticFromRows(attempt.ok ? attempt.value : null, success.ok ? success.value : null, now, attempt.ok && success.ok);
}

function aiStatus(
  configured: boolean,
  row: AiRow | null,
  sourceIsCurrent: boolean | null,
  queryAvailable: boolean,
): DiagnosticStatus {
  if (!configured) return "not_configured";
  if (!queryAvailable) return "unknown";
  if (!row) return "warning";
  if (sourceIsCurrent == null) return "unknown";
  return sourceIsCurrent ? "ok" : "stale";
}

function migrationDiagnostics(rows: MigrationRow[] | null): SystemDiagnostics["migrations"] {
  if (!rows) {
    return { status: "unknown", currentMigration: CURRENT_SCHEMA_MIGRATION, latestApplied: null, appliedCount: null, failedCount: null };
  }
  const validRows = rows.filter((row) => typeof row.migration_name === "string");
  const failedRows = rows.filter((row) => typeof row.migration_name !== "string"
    || row.rolled_back_at != null
    || row.finished_at == null
    || Number(row.applied_steps_count) < 1
    || EXPECTED_MIGRATION_CHECKSUMS[row.migration_name] !== row.checksum);
  const appliedRows = validRows.filter((row) => row.finished_at != null && row.rolled_back_at == null && Number(row.applied_steps_count) >= 1);
  const latestApplied = appliedRows.at(-1)?.migration_name as string | undefined;
  const completeSequence = rows.length === EXPECTED_MIGRATIONS.length
    && appliedRows.length === EXPECTED_MIGRATIONS.length
    && EXPECTED_MIGRATIONS.every((name, index) => appliedRows[index]?.migration_name === name);
  return {
    status: failedRows.length > 0 ? "failed" : completeSequence ? "ok" : "warning",
    currentMigration: CURRENT_SCHEMA_MIGRATION,
    latestApplied: latestApplied ?? null,
    appliedCount: appliedRows.length,
    failedCount: failedRows.length,
  };
}

function offlineSync(): SyncDiagnostic {
  return {
    status: "unknown",
    latestAttemptStatus: null,
    latestAttemptAt: null,
    lastSuccessfulSyncAt: null,
    lastFailureRecorded: false,
    stale: null,
  };
}

function notConfiguredSync(): SyncDiagnostic {
  return {
    status: "not_configured",
    latestAttemptStatus: null,
    latestAttemptAt: null,
    lastSuccessfulSyncAt: null,
    lastFailureRecorded: false,
    stale: null,
  };
}

export async function buildSystemDiagnostics(options: {
  db?: PrismaClient;
  env?: DiagnosticEnvironment;
  now?: Date;
} = {}): Promise<SystemDiagnostics> {
  const db = options.db ?? defaultPrisma;
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const configuration = getSafeEnvironmentStatus(env);
  const accountId = configuredAccountId(env);
  const campaignId = configuredCampaignId(env);
  const attributionKey = configuredAttributionKey(env);
  const metaConfig = loadMetaActionConfig(env);
  const highLevel = loadHighLevelSettings(env);
  const databaseStarted = Date.now();
  const databaseProbe = await safeQuery(() => db.$queryRaw`SELECT 1`);
  const databaseLatency = databaseProbe.ok ? Date.now() - databaseStarted : null;

  if (!databaseProbe.ok) {
    const metaStatus: DiagnosticStatus = configuration.meta === "configured" ? "unknown" : "not_configured";
    const highLevelStatus: DiagnosticStatus = highLevel.status === "configured"
      ? "unknown"
      : highLevel.status === "disabled" ? "disabled" : highLevel.status === "not_configured" ? "not_configured" : "misconfigured";
    return {
      schemaVersion: 1,
      checkedAt,
      configuration,
      database: { status: "failed", configuration: configuration.database, latencyMs: null, sync: offlineSync() },
      migrations: migrationDiagnostics(null),
      meta: {
        status: metaStatus,
        configuration: configuration.meta,
        graphVersion: metaConfig.graphVersion,
        campaignScoped: Boolean(campaignId),
        actionGate: metaActionGate(env),
        sync: offlineSync(),
      },
      ai: {
        status: configuration.ai === "configured" ? "unknown" : "not_configured",
        configuration: configuration.ai,
        lastGeneratedAt: null,
        currentSource: null,
      },
      highLevel: {
        status: highLevelStatus,
        configuration: highLevel.status,
        providerReady: highLevel.providerReady,
        mappingReady: highLevel.mappingReady,
        revenueReady: highLevel.revenueReady,
        issues: highLevel.errors.slice(0, 8),
        sync: offlineSync(),
      },
    };
  }

  const metaRead = await readMetaSync(db, accountId, campaignId, attributionKey, now);
  const migrationRows = await safeQuery(() => db.$queryRawUnsafe<MigrationRow[]>(
    'SELECT "migration_name", "checksum", "finished_at", "rolled_back_at", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "started_at" ASC',
  ));
  const aiResult = accountId
    ? await safeQuery(() => db.aiBriefing.findFirst({
      where: { accountId, campaignId, attributionKey },
      orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
      select: { generatedAt: true, sourceSyncRunId: true },
    }))
    : { ok: true as const, value: null };
  const crmSync = await readCrmSync(db, highLevel.locationId, highLevel.pipelineId, highLevel.mappingHash, now);
  const aiRow = aiResult.ok ? aiResult.value : null;
  let aiSourceIsCurrent: boolean | null = null;
  if (aiRow && metaRead.available) {
    if (!metaRead.latestSuccessId || aiRow.sourceSyncRunId !== metaRead.latestSuccessId) {
      aiSourceIsCurrent = false;
    } else if (metaRead.diagnostic.stale != null) {
      aiSourceIsCurrent = !metaRead.diagnostic.stale;
    }
  }
  const aiConfigured = configuration.ai === "configured";
  const metaStatus: DiagnosticStatus = configuration.meta === "not_configured"
    ? "not_configured"
    : metaRead.diagnostic.status;
  const highLevelStatus: DiagnosticStatus = highLevel.status === "not_configured"
    ? "not_configured"
    : highLevel.status === "disabled"
      ? "disabled"
      : highLevel.status === "misconfigured"
        ? "misconfigured"
        : crmSync.status;

  return {
    schemaVersion: 1,
    checkedAt,
    configuration,
    database: {
      status: configuration.database === "configured" ? "ok" : "failed",
      configuration: configuration.database,
      latencyMs: databaseLatency,
      sync: metaRead.diagnostic,
    },
    migrations: migrationDiagnostics(migrationRows.ok ? migrationRows.value : null),
    meta: {
      status: metaStatus,
      configuration: configuration.meta,
      graphVersion: metaConfig.graphVersion,
      campaignScoped: Boolean(campaignId),
      actionGate: metaActionGate(env),
      sync: metaRead.diagnostic,
    },
    ai: {
      status: aiStatus(aiConfigured, aiRow, aiSourceIsCurrent, aiResult.ok),
      configuration: configuration.ai,
      lastGeneratedAt: iso(aiRow?.generatedAt),
      currentSource: aiSourceIsCurrent,
    },
    highLevel: {
      status: highLevelStatus,
      configuration: highLevel.status,
      providerReady: highLevel.providerReady,
      mappingReady: highLevel.mappingReady,
      revenueReady: highLevel.revenueReady,
      issues: highLevel.errors.slice(0, 8),
      sync: crmSync,
    },
  };
}
