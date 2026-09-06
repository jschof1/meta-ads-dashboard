import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { InStatement } from "@libsql/client";
import { withDatabaseClient } from "@/lib/db";
import { safeJson } from "@/lib/safe-json";
import {
  COMPARISON_WINDOWS,
  RECOMMENDATION_RULE_VERSION,
  RECOMMENDATION_TARGET_TYPES,
  RECOMMENDATION_TYPES,
  type RecommendationCandidate,
  type RecommendationEvidence,
} from "@/lib/recommendation-types";
import type { RecommendationView } from "@/lib/state-types";

export type RecommendationPersistenceInput = {
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
  syncRunId: string;
  recommendations: readonly RecommendationCandidate[];
  /** Partial observations may update current evidence without resolving old rows. */
  reconcile?: boolean;
  now?: Date;
};

export type RecommendationPersistenceResult = {
  created: number;
  updated: number;
  resolved: number;
  active: number;
};

const METRIC_KEYS = [
  "spendCents",
  "impressions",
  "reach",
  "clicks",
  "linkClicks",
  "leads",
  "frequency",
  "cplCents",
  "cpmCents",
  "cpcCents",
  "ctrLink",
] as const;

const DELTA_KEYS = ["spendPct", "leadsPct", "cplPct", "ctrPct", "frequencyPct"] as const;
const THRESHOLD_NUMBER_KEYS = [
  "minLeads",
  "minImpressions",
  "frequencyWatch",
  "frequencyAlert",
] as const;
const THRESHOLD_OPTIONAL_KEYS = [
  "minSpendCents",
  "cplTargetCents",
  "cplAcceptableCents",
  "cplMaximumCents",
  "expectedSpendCents",
  "budgetCents",
] as const;
const CONFIDENCE_FACTOR_KEYS = [
  "currentSpendImpressionsComplete",
  "currentLeadsKnown",
  "currentEvidenceSufficient",
  "previousEvidenceSufficient",
  "sampleSizeSufficient",
  "seriesSufficient",
  "daysActiveSufficient",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function hasKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validMetrics(value: unknown): boolean {
  return isRecord(value)
    && hasKeys(value, METRIC_KEYS)
    && METRIC_KEYS.every((key) => {
      const metric = value[key];
      return isFiniteNumberOrNull(metric) && (metric === null || metric >= 0);
    });
}

function validRange(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value)
    && typeof value.since === "string"
    && typeof value.until === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value.since)
    && /^\d{4}-\d{2}-\d{2}$/.test(value.until);
}

function validSeries(value: unknown): boolean {
  return Array.isArray(value) && value.every((point) => isRecord(point)
    && typeof point.date === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(point.date)
    && validMetrics(point.metrics));
}

/** Parse only the versioned evidence shape produced by the pure engine. */
export function parseRecommendationEvidence(encoded: string): RecommendationEvidence | null {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const ranges = isRecord(value.ranges) ? value.ranges : null;
  const deltas = isRecord(value.deltas) ? value.deltas : null;
  const thresholds = isRecord(value.thresholds) ? value.thresholds : null;
  const confidenceFactors = isRecord(value.confidenceFactors) ? value.confidenceFactors : null;
  if (value.evidenceVersion !== 1
    || value.ruleVersion !== RECOMMENDATION_RULE_VERSION
    || !COMPARISON_WINDOWS.includes(value.comparisonDays as (typeof COMPARISON_WINDOWS)[number])
    || !Number.isInteger(value.sampleSize)
    || (value.sampleSize as number) < 0
    || !Number.isInteger(value.seriesPoints)
    || (value.seriesPoints as number) < 0
    || !(value.daysActive === null || (typeof value.daysActive === "number" && Number.isFinite(value.daysActive)))
    || !(typeof value.confidenceScore === "number" && Number.isInteger(value.confidenceScore) && value.confidenceScore >= 0 && value.confidenceScore <= 100)
    || !confidenceFactors
    || !hasKeys(confidenceFactors, CONFIDENCE_FACTOR_KEYS)
    || !CONFIDENCE_FACTOR_KEYS.every((key) => typeof confidenceFactors[key] === "boolean")
    || !ranges
    || !validRange(ranges.current)
    || !validRange(ranges.previous)
    || !validRange(ranges.cumulative)
    || !validMetrics(value.current)
    || !(value.previous === null || validMetrics(value.previous))
    || !(value.cumulative === null || validMetrics(value.cumulative))
    || !validSeries(value.series)
    || (value.series as unknown[]).length !== value.seriesPoints
    || !(value.status === null || typeof value.status === "string")
    || !(value.learningState === null || typeof value.learningState === "string")
    || !deltas
    || !hasKeys(deltas, DELTA_KEYS)
    || !DELTA_KEYS.every((key) => isFiniteNumberOrNull(deltas[key]))
    || !thresholds
    || !hasKeys(thresholds, [...THRESHOLD_NUMBER_KEYS, ...THRESHOLD_OPTIONAL_KEYS])
    || !THRESHOLD_NUMBER_KEYS.every((key) => typeof thresholds[key] === "number" && Number.isFinite(thresholds[key]))
    || !THRESHOLD_OPTIONAL_KEYS.every((key) => isFiniteNumberOrNull(thresholds[key]))
    || !Array.isArray(value.notes)
    || !value.notes.every((note) => typeof note === "string")) {
    return null;
  }
  return value as unknown as RecommendationEvidence;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function serialiseEvidence(evidence: RecommendationEvidence): string {
  const encoded = safeJson(stableValue(evidence));
  if (!parseRecommendationEvidence(encoded)) {
    throw new Error("Recommendation evidence failed validation");
  }
  return encoded;
}

function fingerprint(input: RecommendationPersistenceInput, recommendation: RecommendationCandidate): string {
  return [
    input.accountId,
    input.campaignId ?? "account",
    input.attributionKey,
    recommendation.key,
  ].join("|");
}

function storedTimestampMs(column: "lastSeenAt" | "resolvedAt" | "observedAt"): string {
  // Historic SQLite rows use epoch milliseconds; PrismaLibSQL now writes ISO
  // strings. SQLite compares storage classes, not dates, unless normalized.
  // Round away julianday's floating-point error to preserve millisecond ties.
  return `CASE WHEN typeof("${column}") IN ('integer', 'real') THEN "${column}"
    ELSE round((julianday("${column}") - 2440587.5) * 86400000) END`;
}

// A resolution is also an observation: an older candidate cannot reopen it.
const CURRENT_OBSERVATION = `(${storedTimestampMs("lastSeenAt")}) <= ?
  AND ("resolvedAt" IS NULL OR (${storedTimestampMs("resolvedAt")}) <= ?)`;

const SCOPE_OBSERVATION = `EXISTS (SELECT 1 FROM "RecommendationScopeState"
  WHERE "id" = ? AND (${storedTimestampMs("observedAt")}) = ? AND "sourceSyncRunId" = ?)`;

/**
 * Store the current recommendation set and, when reconciliation is allowed,
 * resolve only recommendations in the same account/campaign/attribution/rule
 * scope that were not seen in this successful sync. The unique fingerprint
 * makes retries idempotent.
 */
export async function persistRecommendationLifecycle(
  db: PrismaClient,
  input: RecommendationPersistenceInput,
): Promise<RecommendationPersistenceResult> {
  const now = input.now ?? new Date();
  const observedAtMs = now.getTime();
  if (!Number.isFinite(observedAtMs)) throw new Error("Invalid recommendation observation date");
  // Match PrismaLibSQL's default DateTime encoding. Audit timestamps describe
  // persistence time, while first/lastSeenAt describe the source observation.
  const observedAt = now.toISOString().replace("Z", "+00:00");
  const writtenAt = new Date().toISOString().replace("Z", "+00:00");
  const scopeStateId = JSON.stringify([input.accountId, input.campaignId, input.attributionKey, RECOMMENDATION_RULE_VERSION]);
  const uniqueRecommendations = Array.from(
    new Map(input.recommendations.map((recommendation) => [recommendation.key, recommendation])).values(),
  );
  const fingerprints = uniqueRecommendations.map((recommendation) => fingerprint(input, recommendation));
  // Do not pass membership lists through safeJson: its array limit would drop
  // candidates. One bound JSON array avoids an IN parameter per fingerprint.
  const encodedFingerprints = JSON.stringify(fingerprints);
  const statements: InStatement[] = [{
    // Scope progress must survive empty observations and cover unseen keys.
    // Before the first watermark, existing rows still fence older analyses.
    sql: `INSERT INTO "RecommendationScopeState"
      ("id", "accountId", "campaignId", "attributionKey", "ruleVersion", "observedAt", "sourceSyncRunId", "updatedAt")
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM "Recommendation"
        WHERE "accountId" = ? AND "campaignId" IS ? AND "attributionKey" = ? AND "ruleVersion" = ?
          AND ((${storedTimestampMs("lastSeenAt")}) > ? OR (${storedTimestampMs("resolvedAt")}) > ?))
      ON CONFLICT ("id") DO UPDATE SET
        "observedAt" = excluded."observedAt", "sourceSyncRunId" = excluded."sourceSyncRunId",
        "updatedAt" = excluded."updatedAt"
      WHERE (${storedTimestampMs("observedAt")}) < ?
        OR ((${storedTimestampMs("observedAt")}) = ? AND "sourceSyncRunId" = excluded."sourceSyncRunId")`,
    args: [scopeStateId, input.accountId, input.campaignId, input.attributionKey, RECOMMENDATION_RULE_VERSION,
      observedAt, input.syncRunId, writtenAt,
      input.accountId, input.campaignId, input.attributionKey, RECOMMENDATION_RULE_VERSION, observedAtMs, observedAtMs,
      observedAtMs, observedAtMs],
  }, {
    sql: `SELECT "fingerprint" FROM "Recommendation"
      WHERE "fingerprint" IN (SELECT value FROM json_each(?))`,
    args: [encodedFingerprints],
  }, {
    sql: `UPDATE "Recommendation"
      SET "lifecycle" = 'RESOLVED', "resolvedAt" = ?, "updatedAt" = ?
      WHERE ? = 1 AND "accountId" = ? AND "campaignId" IS ?
        AND "attributionKey" = ? AND "ruleVersion" = ? AND "lifecycle" = 'OPEN'
        AND "fingerprint" NOT IN (SELECT value FROM json_each(?))
        AND ${CURRENT_OBSERVATION} AND ${SCOPE_OBSERVATION}`,
    args: [observedAt, writtenAt, input.reconcile === false ? 0 : 1,
      input.accountId, input.campaignId, input.attributionKey, RECOMMENDATION_RULE_VERSION,
      encodedFingerprints, observedAtMs, observedAtMs, scopeStateId, observedAtMs, input.syncRunId],
  }];
  // Validate the deduplicated evidence before opening the batch. Any invalid
  // candidate leaves both reconciliation and all other candidates untouched.
  for (const [index, recommendation] of uniqueRecommendations.entries()) {
    const evidence = serialiseEvidence(recommendation.evidence);
    statements.push({
      sql: `INSERT INTO "Recommendation" (
        "id", "fingerprint", "accountId", "campaignId", "attributionKey", "type",
        "analysisWindowDays", "ruleVersion", "targetType", "targetId", "targetName",
        "severity", "confidence", "lifecycle", "reason", "evidence", "proposedAction",
        "sourceSyncRunId", "firstSeenAt", "lastSeenAt", "resolvedAt", "createdAt", "updatedAt"
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, NULL, ?, ?
      WHERE ${SCOPE_OBSERVATION}
      ON CONFLICT ("fingerprint") DO UPDATE SET
        "accountId" = excluded."accountId", "campaignId" = excluded."campaignId",
        "attributionKey" = excluded."attributionKey", "type" = excluded."type",
        "analysisWindowDays" = excluded."analysisWindowDays", "ruleVersion" = excluded."ruleVersion",
        "targetType" = excluded."targetType", "targetId" = excluded."targetId", "targetName" = excluded."targetName",
        "severity" = excluded."severity", "confidence" = excluded."confidence",
        "lifecycle" = 'OPEN', "reason" = excluded."reason", "evidence" = excluded."evidence",
        "proposedAction" = excluded."proposedAction", "sourceSyncRunId" = excluded."sourceSyncRunId",
        "lastSeenAt" = excluded."lastSeenAt", "resolvedAt" = NULL, "updatedAt" = excluded."updatedAt"
      WHERE ${CURRENT_OBSERVATION}`,
      args: [randomUUID(), fingerprints[index], input.accountId, input.campaignId, input.attributionKey,
        recommendation.type, recommendation.evidence.comparisonDays, RECOMMENDATION_RULE_VERSION,
        recommendation.target.type, recommendation.target.id, recommendation.target.name,
        recommendation.severity, recommendation.confidence, recommendation.reason, evidence,
        recommendation.proposedAction, input.syncRunId, observedAt, observedAt, writtenAt, writtenAt,
        scopeStateId, observedAtMs, input.syncRunId, observedAtMs, observedAtMs],
    });
  }

  // Turso's five-second interactive transaction limit cannot be extended by
  // Prisma. One native write batch runs these reads and writes atomically on
  // the server, including rollback on any statement failure:
  // https://docs.turso.tech/sdk/ts/reference#batch-transactions
  const results = await withDatabaseClient(db, (client) => client.batch(statements, "write"));
  const existing = new Set(results[1].rows.map((row) => row.fingerprint));
  let created = 0;
  let updated = 0;
  fingerprints.forEach((key, index) => {
    if (existing.has(key)) updated += results[index + 3].rowsAffected;
    else created += results[index + 3].rowsAffected;
  });
  return { created, updated, resolved: results[2].rowsAffected, active: uniqueRecommendations.length };
}

type RecommendationReadScope = {
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
};

const SEVERITY_ORDER: Record<RecommendationView["severity"], number> = { alert: 0, watch: 1, info: 2 };
const TYPE_ORDER = new Map(RECOMMENDATION_TYPES.map((type, index) => [type, index]));

function validRecommendationType(value: string): value is RecommendationView["type"] {
  return (RECOMMENDATION_TYPES as readonly string[]).includes(value);
}

function validTargetType(value: string): value is RecommendationView["target"]["type"] {
  return (RECOMMENDATION_TARGET_TYPES as readonly string[]).includes(value);
}

function validSeverity(value: string): value is RecommendationView["severity"] {
  return value === "alert" || value === "watch" || value === "info";
}

function validConfidence(value: string): value is RecommendationView["confidence"] {
  return value === "high" || value === "medium" || value === "low";
}

function isoDate(value: Date): string | null {
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

/** Read only active, versioned rows from the exact configured dashboard scope. */
export async function readActiveRecommendationViews(
  db: PrismaClient,
  scope: RecommendationReadScope,
): Promise<RecommendationView[]> {
  const rows = await db.recommendation.findMany({
    where: {
      accountId: scope.accountId,
      campaignId: scope.campaignId,
      attributionKey: scope.attributionKey,
      lifecycle: "OPEN",
    },
  });
  const views: RecommendationView[] = [];
  for (const row of rows) {
    const evidence = parseRecommendationEvidence(row.evidence);
    const firstSeenAt = isoDate(row.firstSeenAt);
    const lastSeenAt = isoDate(row.lastSeenAt);
    if (!evidence
      || row.ruleVersion !== RECOMMENDATION_RULE_VERSION
      || row.analysisWindowDays !== evidence.comparisonDays
      || !validRecommendationType(row.type)
      || !validTargetType(row.targetType)
      || !validSeverity(row.severity)
      || !validConfidence(row.confidence)
      || !row.fingerprint
      || !row.targetId
      || !row.targetName
      || !row.reason
      || !row.proposedAction
      || !firstSeenAt
      || !lastSeenAt
      || row.resolvedAt != null) {
      console.error("Stored recommendation failed validation and was omitted", row.id);
      continue;
    }
    views.push({
      id: row.id,
      fingerprint: row.fingerprint,
      accountId: row.accountId,
      campaignId: row.campaignId,
      attributionKey: row.attributionKey,
      type: row.type,
      analysisWindowDays: row.analysisWindowDays,
      ruleVersion: row.ruleVersion,
      target: { type: row.targetType, id: row.targetId, name: row.targetName.slice(0, 240) },
      severity: row.severity,
      confidence: row.confidence,
      lifecycle: "OPEN",
      reason: row.reason.slice(0, 2_000),
      evidence,
      proposedAction: row.proposedAction.slice(0, 2_000),
      sourceSyncRunId: row.sourceSyncRunId,
      firstSeenAt,
      lastSeenAt,
      resolvedAt: null,
    });
  }
  return views.sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || (TYPE_ORDER.get(left.type) ?? Number.MAX_SAFE_INTEGER) - (TYPE_ORDER.get(right.type) ?? Number.MAX_SAFE_INTEGER)
      || left.target.type.localeCompare(right.target.type)
      || left.target.id.localeCompare(right.target.id)
      || left.id.localeCompare(right.id)
  ));
}
