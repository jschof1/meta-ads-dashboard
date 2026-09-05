import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { MetaClient, MetaConfigurationError } from "@/lib/meta";
import { parseRecommendationEvidence } from "@/lib/recommendation-store";
import { safeJson } from "@/lib/safe-json";
import {
  META_ACTION_KINDS,
  META_ACTION_STATUSES,
  type MetaActionChange,
  type MetaActionExpectedState,
  type MetaActionGate,
  type MetaActionKind,
  type MetaActionStatus,
  type MetaActionStoredValue,
  type MetaActionTargetType,
  type MetaActionView,
  type MetaAdStatus,
} from "@/lib/meta-action-types";
import type { RecommendationConfidence } from "@/lib/recommendation-types";

export type ActionEnvironment = Record<string, string | undefined>;

export type MetaActionScope = {
  campaignId: string | null;
  attributionKey: string;
};

const DEFAULT_GRAPH_VERSION = "v25.0";
const DEFAULT_BUDGET_CHANGE_PERCENT = 20;
const MAX_ID_LENGTH = 128;
const MAX_IDEMPOTENCY_LENGTH = 160;
const EXECUTION_RECOVERY_AFTER_MS = 5 * 60 * 1_000;
const META_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

export type MetaActionConfig = {
  requestedWritesEnabled: boolean;
  writesEnabled: boolean;
  accountId: string | null;
  campaignId: string | null;
  attributionKey: string;
  graphVersion: string;
  maxDailyBudgetMinor: number | null;
  maxBudgetChangePercent: number;
  errors: string[];
};

export type ProposeMetaActionInput = {
  recommendationFingerprint: unknown;
  action: unknown;
  dailyBudgetMinor?: unknown;
  idempotencyKey?: unknown;
};

export type MetaActionResult = {
  action: MetaActionView;
  duplicate: boolean;
};

export type LiveAdState = {
  id: string;
  accountId: string;
  status: string;
  dailyBudgetMinor: number | null;
  campaignId?: string | null;
};

export type LiveAdSetState = LiveAdState;

export type MetaMutationReference = {
  objectId: string;
  traceId?: string;
  revision?: string;
};

export type MetaActionProvider = {
  readAd: (id: string) => Promise<LiveAdState>;
  readAdSet: (id: string) => Promise<LiveAdSetState>;
  updateAdStatus: (id: string, status: MetaAdStatus) => Promise<MetaMutationReference>;
  updateAdSetDailyBudget: (id: string, dailyBudgetMinor: number) => Promise<MetaMutationReference>;
};

export class MetaActionProviderError extends Error {
  readonly name = "MetaActionProviderError";
  readonly traceId?: string;

  constructor(message: string, details: { traceId?: string } = {}) {
    super(message);
    this.traceId = details.traceId;
  }
}

export type MetaActionErrorCode =
  | "configuration"
  | "disabled"
  | "validation"
  | "not_found"
  | "stale"
  | "conflict"
  | "provider"
  | "verification";

export class MetaActionError extends Error {
  readonly name = "MetaActionError";
  readonly code: MetaActionErrorCode;
  readonly statusCode: number;
  readonly action?: MetaActionView;

  constructor(code: MetaActionErrorCode, message: string, action?: MetaActionView) {
    super(message);
    this.code = code;
    this.statusCode = code === "not_found" ? 404 : code === "conflict" || code === "stale" ? 409 : code === "disabled" || code === "configuration" ? 503 : code === "provider" || code === "verification" ? 502 : 400;
    this.action = action;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return isRecord(error) && error.code === "P2002";
}

function isMissingMetaActionTableError(error: unknown): boolean {
  return isRecord(error)
    && (error.code === "P2021" || (typeof error.message === "string" && /no such table:\s*(?:main\.)?MetaAction/.test(error.message)));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  const string = stringValue(value);
  return string && string.length <= maxLength ? string : null;
}

function canonicalAccountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MetaActionError("configuration", "META_AD_ACCOUNT_ID is required for Meta actions");
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function sameAccount(left: string, right: string): boolean {
  try {
    return canonicalAccountId(left) === canonicalAccountId(right);
  } catch {
    return false;
  }
}

function parseInteger(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  return parsePositiveInteger(value.trim());
}

function validMetaObjectId(value: string): boolean {
  return value.length <= MAX_ID_LENGTH && META_ID_PATTERN.test(value);
}

function normaliseGraphVersion(value: string | undefined, errors: string[]): string {
  const version = value?.trim() || DEFAULT_GRAPH_VERSION;
  if (!/^v\d+\.\d+$/.test(version)) {
    errors.push("META_GRAPH_VERSION must look like v25.0");
    return DEFAULT_GRAPH_VERSION;
  }
  return version;
}

function configuredAttributionKey(env: ActionEnvironment): string {
  const windows = env.META_ATTRIBUTION_WINDOWS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (windows && windows.length > 0 ? windows : ["7d_click", "1d_view"]).join(",");
}

/** Parse action configuration without ever treating an invalid value as enabled. */
export function loadMetaActionConfig(env: ActionEnvironment = process.env): MetaActionConfig {
  const errors: string[] = [];
  const rawFlag = env.META_WRITES_ENABLED?.trim() || "";
  const requestedWritesEnabled = rawFlag === "true";
  if (rawFlag && rawFlag !== "true" && rawFlag !== "false") {
    errors.push("META_WRITES_ENABLED must be exactly true or false");
  }

  let accountId: string | null = null;
  if (env.META_AD_ACCOUNT_ID?.trim()) {
    try {
      accountId = canonicalAccountId(env.META_AD_ACCOUNT_ID);
    } catch {
      errors.push("META_AD_ACCOUNT_ID is invalid");
    }
  } else if (requestedWritesEnabled) {
    errors.push("META_AD_ACCOUNT_ID is required when Meta writes are enabled");
  }

  const graphVersion = normaliseGraphVersion(env.META_GRAPH_VERSION, errors);
  const campaignId = env.META_CAMPAIGN_ID?.trim() || null;
  const attributionKey = configuredAttributionKey(env);
  const maxDailyBudgetMinor = parseOptionalPositiveInteger(env.META_ACTION_MAX_DAILY_BUDGET_MINOR);
  if (env.META_ACTION_MAX_DAILY_BUDGET_MINOR?.trim() && maxDailyBudgetMinor == null) {
    errors.push("META_ACTION_MAX_DAILY_BUDGET_MINOR must be a positive integer");
  }
  if (requestedWritesEnabled && maxDailyBudgetMinor == null) {
    errors.push("META_ACTION_MAX_DAILY_BUDGET_MINOR is required when Meta writes are enabled");
  }
  if (requestedWritesEnabled && !env.META_MARKETING_TOKEN?.trim()) {
    errors.push("META_MARKETING_TOKEN is required when Meta writes are enabled");
  }

  const rawPercent = env.META_ACTION_MAX_BUDGET_CHANGE_PERCENT?.trim();
  const maxBudgetChangePercent = rawPercent ? Number(rawPercent) : DEFAULT_BUDGET_CHANGE_PERCENT;
  if (!Number.isFinite(maxBudgetChangePercent) || maxBudgetChangePercent <= 0 || maxBudgetChangePercent > 100) {
    errors.push("META_ACTION_MAX_BUDGET_CHANGE_PERCENT must be greater than 0 and no more than 100");
  }

  return {
    requestedWritesEnabled,
    writesEnabled: requestedWritesEnabled && errors.length === 0,
    accountId,
    campaignId,
    attributionKey,
    graphVersion,
    maxDailyBudgetMinor,
    maxBudgetChangePercent: Number.isFinite(maxBudgetChangePercent) && maxBudgetChangePercent > 0 && maxBudgetChangePercent <= 100
      ? maxBudgetChangePercent
      : DEFAULT_BUDGET_CHANGE_PERCENT,
    errors,
  };
}

function sameScope(left: MetaActionScope, right: MetaActionScope): boolean {
  return left.campaignId === right.campaignId && left.attributionKey === right.attributionKey;
}

function targetLockKey(accountId: string, targetType: MetaActionTargetType, targetId: string): string {
  const digest = createHash("sha256").update(JSON.stringify({ accountId, targetType, targetId })).digest("hex");
  return `meta-target-lock-${digest}`;
}

export function metaActionGate(env: ActionEnvironment = process.env): MetaActionGate {
  const config = loadMetaActionConfig(env);
  if (!config.requestedWritesEnabled) {
    return {
      writesEnabled: false,
      status: "disabled",
      message: "Meta writes are disabled. Prepare and approve actions locally; enabling live execution requires the explicit safety gate.",
    };
  }
  if (!config.writesEnabled) {
    return {
      writesEnabled: false,
      status: "misconfigured",
      message: "Meta writes are not available because the server action configuration is incomplete or invalid.",
    };
  }
  return {
    writesEnabled: true,
    status: "ready",
    message: "Meta writes are enabled on the server. Every action still requires separate approval and execution.",
  };
}

function validAction(value: unknown): value is MetaActionKind {
  return (META_ACTION_KINDS as readonly unknown[]).includes(value);
}

function validStatus(value: unknown): value is MetaActionStatus {
  return (META_ACTION_STATUSES as readonly unknown[]).includes(value);
}

function validTargetType(value: unknown): value is MetaActionTargetType {
  return value === "ad" || value === "adset";
}

function validConfidence(value: unknown): value is RecommendationConfidence {
  return value === "low" || value === "medium" || value === "high";
}

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function parseStoredValue(value: string | null | undefined): MetaActionStoredValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) return null;
    if (Object.keys(parsed).length === 1 && typeof parsed.status === "string" && parsed.status.trim().length > 0 && parsed.status.length <= 80) {
      return { status: parsed.status };
    }
    const budget = parsePositiveInteger(parsed.dailyBudgetMinor);
    if (Object.keys(parsed).length === 1 && budget != null) {
      return { dailyBudgetMinor: budget };
    }
  } catch {
    return null;
  }
  return null;
}

function parseRequestedChange(value: string | null | undefined): MetaActionChange | null {
  const parsed = parseStoredValue(value);
  if (!parsed) return null;
  if ("status" in parsed && (parsed.status === "ACTIVE" || parsed.status === "PAUSED")) return { status: parsed.status as MetaAdStatus };
  if ("dailyBudgetMinor" in parsed) return parsed;
  return null;
}

function parseExpectedState(value: string): MetaActionExpectedState | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || typeof parsed.status !== "string" || !parsed.status.trim()) return null;
    const budget = parsed.dailyBudgetMinor;
    if (!(budget === null || parsePositiveInteger(budget) != null)) return null;
    return { status: parsed.status, dailyBudgetMinor: budget === null ? null : parsePositiveInteger(parsed.dailyBudgetMinor) };
  } catch {
    return null;
  }
}

function parseActionRow(row: {
  id: string;
  accountId: string;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  status: string;
  requestedChange: string;
  expectedState: string;
  oldValue: string | null;
  newValue: string | null;
  reasoning: string;
  evidence: string;
  confidence: string;
  source: string;
  recommendationFingerprint: string | null;
  sourceSyncRunId: string | null;
  metaObjectId: string | null;
  metaTraceId: string | null;
  error: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  executingAt: Date | null;
  executedAt: Date | null;
  failedAt: Date | null;
  updatedAt: Date;
}): MetaActionView {
  if (!validAction(row.action) || !validTargetType(row.targetType) || !validStatus(row.status) || row.source !== "operator" || !validConfidence(row.confidence)) {
    throw new MetaActionError("validation", "Stored Meta action failed validation");
  }
  const requestedChange = parseRequestedChange(row.requestedChange);
  const expectedState = parseExpectedState(row.expectedState);
  const oldValue = parseStoredValue(row.oldValue);
  const newValue = parseStoredValue(row.newValue);
  const evidence = parseRecommendationEvidence(row.evidence);
  const createdAt = iso(row.createdAt);
  const updatedAt = iso(row.updatedAt);
  if (!requestedChange || !expectedState || (row.oldValue != null && !oldValue) || (row.newValue != null && !newValue) || !evidence || !createdAt || !updatedAt || !row.accountId || !row.targetId || !row.targetName) {
    throw new MetaActionError("validation", "Stored Meta action failed validation");
  }
  return {
    id: row.id,
    accountId: row.accountId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName.slice(0, 240),
    status: row.status,
    requestedChange,
    expectedState,
    oldValue,
    newValue,
    reasoning: row.reasoning.slice(0, 2_000),
    evidence,
    confidence: row.confidence,
    source: "operator",
    recommendationFingerprint: row.recommendationFingerprint,
    sourceSyncRunId: row.sourceSyncRunId,
    metaObjectId: row.metaObjectId,
    metaTraceId: row.metaTraceId,
    error: row.error?.slice(0, 500) ?? null,
    createdAt,
    approvedAt: iso(row.approvedAt),
    approvedBy: row.approvedBy?.slice(0, 120) ?? null,
    rejectedAt: iso(row.rejectedAt),
    rejectedBy: row.rejectedBy?.slice(0, 120) ?? null,
    executingAt: iso(row.executingAt),
    executedAt: iso(row.executedAt),
    failedAt: iso(row.failedAt),
    updatedAt,
  };
}

function actionReference(reference: MetaMutationReference | null): string | null {
  if (!reference) return null;
  const parts = [`meta:${reference.objectId}`];
  if (reference.traceId) parts.push(`trace:${reference.traceId.slice(0, 120)}`);
  if (reference.revision) parts.push(`revision:${reference.revision.slice(0, 120)}`);
  return parts.join(" ");
}

function providerTrace(error: unknown): string | undefined {
  return error instanceof MetaActionProviderError ? error.traceId : undefined;
}

function providerErrorMessage(error: unknown, operation: "read" | "write" | "verify"): string {
  if (operation === "read") return "Meta target could not be read; no mutation was attempted.";
  if (operation === "verify") return "Meta mutation could not be verified; no automatic retry was attempted.";
  return "Meta mutation outcome is uncertain; no automatic retry was attempted.";
}

function normaliseReference(reference: MetaMutationReference, targetId: string): MetaMutationReference {
  const objectId = boundedString(reference.objectId, MAX_ID_LENGTH);
  if (!objectId || !validMetaObjectId(objectId) || objectId !== targetId) {
    return { objectId: targetId, traceId: boundedString(reference.traceId, 120) ?? undefined, revision: boundedString(reference.revision, 120) ?? undefined };
  }
  return {
    objectId,
    traceId: boundedString(reference.traceId, 120) ?? undefined,
    revision: boundedString(reference.revision, 120) ?? undefined,
  };
}

function budgetWithinLimits(value: number, current: number, config: MetaActionConfig): boolean {
  if (config.maxDailyBudgetMinor == null || value <= 0 || value > config.maxDailyBudgetMinor || current <= 0) return false;
  return Math.abs(value - current) * 100 <= current * config.maxBudgetChangePercent;
}

function desiredChangeForAction(action: MetaActionKind, input: ProposeMetaActionInput, current: { status: string; dailyBudgetMinor: number | null }, config: MetaActionConfig): MetaActionChange {
  if (action === "pause_ad") {
    if (current.status !== "ACTIVE") throw new MetaActionError("stale", "Only an active ad can be paused; prepare a fresh action from current evidence");
    return { status: "PAUSED" };
  }
  if (action === "resume_ad") {
    if (current.status !== "PAUSED") throw new MetaActionError("stale", "The ad is not currently paused in the durable snapshot");
    return { status: "ACTIVE" };
  }
  const desired = parsePositiveInteger(input.dailyBudgetMinor);
  if (desired == null || current.dailyBudgetMinor == null) throw new MetaActionError("validation", "A positive new ad-set daily budget and known current budget are required");
  if (!budgetWithinLimits(desired, current.dailyBudgetMinor, config)) {
    throw new MetaActionError("validation", "The requested daily budget is outside the configured safety bounds");
  }
  if (desired <= current.dailyBudgetMinor) throw new MetaActionError("validation", "Scale actions must increase the ad-set daily budget");
  return { dailyBudgetMinor: desired };
}

function currentStoredState(target: { effectiveStatus: string | null; configuredStatus: string | null; dailyBudgetMinor?: number | null }): { status: string; dailyBudgetMinor: number | null } {
  const status = target.configuredStatus?.trim() || "";
  return { status, dailyBudgetMinor: target.dailyBudgetMinor ?? null };
}

function assertTargetCampaign(target: { campaignMetaId: string | null }, campaignId: string | null): void {
  if (campaignId && target.campaignMetaId !== campaignId) {
    throw new MetaActionError("stale", "The target is outside the configured campaign scope");
  }
}

function assertStoredState(state: { status: string; dailyBudgetMinor: number | null }, targetType: MetaActionTargetType): void {
  if (!state.status || state.status === "UNKNOWN") throw new MetaActionError("stale", "The target status is unknown in the durable snapshot");
  if (targetType === "adset" && (state.dailyBudgetMinor == null || state.dailyBudgetMinor <= 0)) {
    throw new MetaActionError("stale", "The ad-set daily budget is unknown in the durable snapshot");
  }
}

function expectedStateFor(targetType: MetaActionTargetType, current: { status: string; dailyBudgetMinor: number | null }): MetaActionExpectedState {
  return { status: current.status, dailyBudgetMinor: targetType === "adset" ? current.dailyBudgetMinor : null };
}

function deterministicIdempotencyKey(accountId: string, fingerprint: string, sourceSyncRunId: string, action: MetaActionKind, change: MetaActionChange): string {
  const digest = createHash("sha256").update(JSON.stringify({ accountId, fingerprint, sourceSyncRunId, action, change })).digest("hex");
  return `meta-action-${digest}`;
}

function deterministicActionFingerprint(accountId: string, fingerprint: string, sourceSyncRunId: string, action: MetaActionKind, change: MetaActionChange): string {
  const digest = createHash("sha256").update(JSON.stringify({ accountId, fingerprint, sourceSyncRunId, action, change })).digest("hex");
  return `meta-action-payload-${digest}`;
}

function normaliseIdempotencyKey(value: unknown, fallback: string): string {
  if (value == null || value === "") return fallback;
  const key = boundedString(value, MAX_IDEMPOTENCY_LENGTH);
  if (!key || !IDEMPOTENCY_PATTERN.test(key)) throw new MetaActionError("validation", "idempotencyKey contains unsupported characters");
  return key;
}

function sameJson(left: string, right: string): boolean {
  try {
    return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right));
  } catch {
    return left === right;
  }
}

function sameExistingAction(row: { accountId: string; actionFingerprint: string; action: string; targetType: string; targetId: string; requestedChange: string }, input: { accountId: string; actionFingerprint: string; action: MetaActionKind; targetType: MetaActionTargetType; targetId: string; requestedChange: string }): boolean {
  return sameAccount(row.accountId, input.accountId)
    && row.actionFingerprint === input.actionFingerprint
    && row.action === input.action
    && row.targetType === input.targetType
    && row.targetId === input.targetId
    && sameJson(row.requestedChange, input.requestedChange);
}

type RecommendationRow = {
  id: string;
  fingerprint: string;
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
  type: string;
  targetType: string;
  targetId: string;
  targetName: string;
  confidence: string;
  lifecycle: string;
  reason: string;
  evidence: string;
  proposedAction: string;
  sourceSyncRunId: string | null;
};

async function readRecommendation(db: PrismaClient, fingerprint: string, accountId: string): Promise<RecommendationRow> {
  const recommendation = await db.recommendation.findUnique({ where: { fingerprint } });
  if (!recommendation || !sameAccount(recommendation.accountId, accountId)) throw new MetaActionError("not_found", "The stored recommendation is not available in this account scope");
  if (recommendation.lifecycle !== "OPEN") throw new MetaActionError("conflict", "The recommendation is no longer open for action");
  return recommendation;
}

async function latestSuccessfulRun(db: PrismaClient, recommendation: RecommendationRow): Promise<{ id: string } | null> {
  return db.syncRun.findFirst({
    where: {
      accountId: recommendation.accountId,
      campaignId: recommendation.campaignId,
      attributionKey: recommendation.attributionKey,
      status: "SUCCEEDED",
    },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
    select: { id: true },
  });
}

function ensureRecommendationAction(recommendation: RecommendationRow, action: MetaActionKind, targetType: MetaActionTargetType, current: { status: string; dailyBudgetMinor: number | null }): void {
  if (action === "pause_ad" && (recommendation.type !== "pause_candidate" || recommendation.targetType !== "ad" || targetType !== "ad")) {
    throw new MetaActionError("validation", "Only an open ad pause recommendation can prepare a pause action");
  }
  if (action === "resume_ad" && (recommendation.type !== "hold" || recommendation.targetType !== "ad" || targetType !== "ad" || current.status !== "PAUSED" || !/reactivat|resume/i.test(recommendation.proposedAction))) {
    throw new MetaActionError("validation", "Only a paused ad with an explicit reactivation recommendation can prepare a resume action");
  }
  if (action === "set_adset_daily_budget" && (recommendation.type !== "scale_candidate" || recommendation.targetType !== "adset" || targetType !== "adset")) {
    throw new MetaActionError("validation", "Only an ad-set scale recommendation can prepare a budget action");
  }
}

function actionCreateData(input: {
  idempotencyKey: string;
  actionFingerprint: string;
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
  action: MetaActionKind;
  targetType: MetaActionTargetType;
  targetId: string;
  targetName: string;
  requestedChange: MetaActionChange;
  expectedState: MetaActionExpectedState;
  recommendation: RecommendationRow;
  evidence: string;
  now: Date;
}): Prisma.MetaActionCreateInput {
  return {
    idempotencyKey: input.idempotencyKey,
    actionFingerprint: input.actionFingerprint,
    targetLockKey: null,
    accountId: input.accountId,
    campaignId: input.campaignId,
    attributionKey: input.attributionKey,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName.slice(0, 240),
    status: "PROPOSED",
    requestedChange: safeJson(input.requestedChange),
    expectedState: safeJson(input.expectedState),
    reasoning: input.recommendation.reason.slice(0, 2_000),
    evidence: input.evidence,
    confidence: input.recommendation.confidence,
    source: "operator",
    recommendationFingerprint: input.recommendation.fingerprint,
    sourceSyncRunId: input.recommendation.sourceSyncRunId,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** Create a proposal only from a validated durable recommendation. */
export async function proposeMetaAction(db: PrismaClient, input: ProposeMetaActionInput, options: { env?: ActionEnvironment; now?: Date } = {}): Promise<MetaActionResult> {
  const config = loadMetaActionConfig(options.env);
  if (!config.accountId) throw new MetaActionError("configuration", "META_AD_ACCOUNT_ID is required before preparing Meta actions");
  const fingerprint = boundedString(input.recommendationFingerprint, 240);
  if (!fingerprint) throw new MetaActionError("validation", "recommendationFingerprint is required");
  if (!validAction(input.action)) throw new MetaActionError("validation", "Unsupported Meta action");
  const action = input.action;
  const recommendation = await readRecommendation(db, fingerprint, config.accountId);
  if (!sameScope(recommendation, config)) throw new MetaActionError("stale", "The recommendation is outside the currently configured Meta sync scope");
  const evidence = parseRecommendationEvidence(recommendation.evidence);
  if (!evidence || !validConfidence(recommendation.confidence)) throw new MetaActionError("validation", "The stored recommendation evidence is not valid for action approval");
  const latest = await latestSuccessfulRun(db, recommendation);
  if (!latest || recommendation.sourceSyncRunId !== latest.id) throw new MetaActionError("stale", "The recommendation is not from the latest successful stored Meta sync");

  const targetType: MetaActionTargetType = action === "set_adset_daily_budget" ? "adset" : "ad";
  if (!validMetaObjectId(recommendation.targetId)) throw new MetaActionError("validation", "The recommendation target id is invalid");
  const target = targetType === "ad"
    ? await db.ad.findUnique({ where: { metaId: recommendation.targetId } })
    : await db.adSet.findUnique({ where: { metaId: recommendation.targetId } });
  if (!target || target.lastSeenSyncRunId !== latest.id) throw new MetaActionError("stale", "The target is not current in the latest successful stored Meta sync");
  assertTargetCampaign(target, config.campaignId);
  const current = currentStoredState(target);
  assertStoredState(current, targetType);
  ensureRecommendationAction(recommendation, action, targetType, current);
  const requestedChange = desiredChangeForAction(action, input, current, config);
  const expectedState = expectedStateFor(targetType, current);
  const accountId = config.accountId;
  const sourceSyncRunId = recommendation.sourceSyncRunId;
  if (!sourceSyncRunId) throw new MetaActionError("stale", "The recommendation has no successful source sync");
  const actionFingerprint = deterministicActionFingerprint(accountId, fingerprint, sourceSyncRunId, action, requestedChange);
  const generatedKey = deterministicIdempotencyKey(accountId, fingerprint, sourceSyncRunId, action, requestedChange);
  const idempotencyKey = normaliseIdempotencyKey(input.idempotencyKey, generatedKey);
  const now = options.now ?? new Date();
  const createInput = actionCreateData({ idempotencyKey, actionFingerprint, accountId, campaignId: recommendation.campaignId, attributionKey: recommendation.attributionKey, action, targetType, targetId: recommendation.targetId, targetName: target.name, requestedChange, expectedState, recommendation, evidence: JSON.stringify(evidence), now });

  const existing = await db.metaAction.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (!sameExistingAction(existing, { accountId, actionFingerprint, action, targetType, targetId: recommendation.targetId, requestedChange: createInput.requestedChange as string })) {
      throw new MetaActionError("conflict", "The idempotency key is already bound to a different Meta action");
    }
    return { action: parseActionRow(existing), duplicate: true };
  }

  try {
    const created = await db.metaAction.create({ data: createInput });
    return { action: parseActionRow(created), duplicate: false };
  } catch (error) {
    // A concurrent request may have won either unique race. Read both keys
    // back and return a row only when its immutable payload matches exactly.
    const raced = await db.metaAction.findUnique({ where: { idempotencyKey } });
    if (raced && sameExistingAction(raced, { accountId, actionFingerprint, action, targetType, targetId: recommendation.targetId, requestedChange: createInput.requestedChange as string })) {
      return { action: parseActionRow(raced), duplicate: true };
    }
    const racedPayload = await db.metaAction.findUnique({ where: { actionFingerprint } });
    if (racedPayload && sameExistingAction(racedPayload, { accountId, actionFingerprint, action, targetType, targetId: recommendation.targetId, requestedChange: createInput.requestedChange as string })) {
      return { action: parseActionRow(racedPayload), duplicate: true };
    }
    void error;
    throw new MetaActionError("conflict", "The Meta action proposal could not be created safely");
  }
}

async function readActionForAccount(db: PrismaClient, id: string, accountId: string, scope?: MetaActionScope) {
  const action = await db.metaAction.findUnique({ where: { id } });
  if (!action || !sameAccount(action.accountId, accountId) || (scope && !sameScope(action, scope))) throw new MetaActionError("not_found", "Meta action not found");
  return action;
}

async function transitionMetaAction(db: PrismaClient, id: string, nextStatus: "APPROVED" | "REJECTED", actor: string, options: { env?: ActionEnvironment; now?: Date } = {}): Promise<MetaActionResult> {
  const config = loadMetaActionConfig(options.env);
  if (!config.accountId) throw new MetaActionError("configuration", "META_AD_ACCOUNT_ID is required before changing Meta action state");
  const now = options.now ?? new Date();
  await recoverStaleExecutingActions(db, { accountId: config.accountId }, now);
  const existing = await readActionForAccount(db, id, config.accountId, config);
  if (nextStatus === "APPROVED" && (!validTargetType(existing.targetType) || !validMetaObjectId(existing.targetId))) {
    throw new MetaActionError("validation", "Stored Meta action target is invalid");
  }
  const lock = nextStatus === "APPROVED"
    ? targetLockKey(config.accountId, existing.targetType as MetaActionTargetType, existing.targetId)
    : null;
  let result;
  try {
    result = await db.metaAction.updateMany({
      where: { id, accountId: config.accountId, campaignId: config.campaignId, attributionKey: config.attributionKey, status: "PROPOSED" },
      data: nextStatus === "APPROVED"
        ? { status: nextStatus, targetLockKey: lock, approvedAt: now, approvedBy: actor.slice(0, 120), error: null }
        : { status: nextStatus, rejectedAt: now, rejectedBy: actor.slice(0, 120), error: null },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new MetaActionError("conflict", "Another approved Meta action already holds this target; review the existing action");
    throw error;
  }
  if (result.count === 0) throw new MetaActionError("conflict", `Only a proposed Meta action can be ${nextStatus.toLowerCase()}`, parseActionRow(existing));
  const updated = await db.metaAction.findUnique({ where: { id } });
  if (!updated) throw new MetaActionError("not_found", "Meta action not found after state transition");
  return { action: parseActionRow(updated), duplicate: false };
}

export function approveMetaAction(db: PrismaClient, id: string, options: { env?: ActionEnvironment; actor?: string; now?: Date } = {}): Promise<MetaActionResult> {
  return transitionMetaAction(db, id, "APPROVED", options.actor ?? "operator", options);
}

export function rejectMetaAction(db: PrismaClient, id: string, options: { env?: ActionEnvironment; actor?: string; now?: Date } = {}): Promise<MetaActionResult> {
  return transitionMetaAction(db, id, "REJECTED", options.actor ?? "operator", options);
}

async function failClaimedAction(db: PrismaClient, row: { id: string; action: string; targetId: string; reasoning: string }, details: { message: string; oldValue?: MetaActionStoredValue | null; newValue?: MetaActionChange | null; reference?: MetaMutationReference | null; traceId?: string; now: Date; actor: string }): Promise<MetaActionView> {
  const oldValue = details.oldValue ? safeJson(details.oldValue) : null;
  const newValue = details.newValue ? safeJson(details.newValue) : null;
  const reference = actionReference(details.reference ?? (details.traceId ? { objectId: row.targetId, traceId: details.traceId } : null));
  const updated = await db.$transaction(async (tx) => {
    const changed = await tx.metaAction.updateMany({
      where: { id: row.id, status: "EXECUTING" },
      data: {
        status: "FAILED",
        targetLockKey: null,
        oldValue,
        newValue,
        metaObjectId: details.reference?.objectId ?? row.targetId,
        metaTraceId: details.reference?.traceId ?? details.traceId ?? null,
        error: details.message,
        failedAt: details.now,
      },
    });
    const current = await tx.metaAction.findUnique({ where: { id: row.id } });
    if (changed.count > 0) {
      await tx.actionLog.create({
        data: {
          action: row.action,
          targetId: row.targetId,
          reasoning: row.reasoning,
          executor: details.actor,
          result: `FAILED: ${details.message}`,
          metaActionId: row.id,
          oldValue,
          newValue,
          metaReference: reference,
        },
      });
    }
    return current;
  });
  if (!updated) throw new MetaActionError("not_found", "Meta action not found after failure");
  return parseActionRow(updated);
}

type ActionRecoveryScope = { accountId: string; campaignId?: string | null; attributionKey?: string };

async function recoverStaleExecutingActions(db: PrismaClient, scope: ActionRecoveryScope, now: Date): Promise<void> {
  const before = new Date(now.getTime() - EXECUTION_RECOVERY_AFTER_MS);
  let rows: Array<{ id: string; action: string; targetId: string; reasoning: string }>;
  try {
    rows = await db.metaAction.findMany({
      where: {
        accountId: scope.accountId,
        ...(scope.campaignId !== undefined ? { campaignId: scope.campaignId } : {}),
        ...(scope.attributionKey !== undefined ? { attributionKey: scope.attributionKey } : {}),
        status: "EXECUTING",
        executingAt: { lt: before },
      },
      select: { id: true, action: true, targetId: true, reasoning: true },
    });
  } catch (error) {
    if (isMissingMetaActionTableError(error)) return;
    throw error;
  }
  for (const row of rows) {
    await failClaimedAction(db, row, {
      message: "Meta action execution was interrupted before its final audit; inspect Meta and prepare a fresh action.",
      now,
      actor: "system",
    });
  }
}

async function completeClaimedAction(db: PrismaClient, row: { id: string; action: string; targetId: string; reasoning: string }, oldValue: MetaActionStoredValue, newValue: MetaActionChange, reference: MetaMutationReference, now: Date, actor: string): Promise<MetaActionView> {
  const oldEncoded = safeJson(oldValue);
  const newEncoded = safeJson(newValue);
  const safeReference = actionReference(reference);
  const updated = await db.$transaction(async (tx) => {
    const changed = await tx.metaAction.updateMany({
      where: { id: row.id, status: "EXECUTING" },
      data: {
        status: "EXECUTED",
        targetLockKey: null,
        oldValue: oldEncoded,
        newValue: newEncoded,
        metaObjectId: reference.objectId,
        metaTraceId: reference.traceId ?? null,
        error: null,
        executedAt: now,
      },
    });
    if (changed.count === 0) throw new MetaActionError("conflict", "Meta action was no longer executing");
    await tx.actionLog.create({
      data: {
        action: row.action,
        targetId: row.targetId,
        reasoning: row.reasoning,
        executor: actor,
        result: `EXECUTED: old=${oldEncoded}; new=${newEncoded}`,
        metaActionId: row.id,
        oldValue: oldEncoded,
        newValue: newEncoded,
        metaReference: safeReference,
      },
    });
    return tx.metaAction.findUnique({ where: { id: row.id } });
  });
  if (!updated) throw new MetaActionError("not_found", "Meta action not found after execution");
  return parseActionRow(updated);
}

function requestStatusFor(change: MetaActionChange): MetaAdStatus | null {
  return "status" in change ? change.status : null;
}

function requestBudgetFor(change: MetaActionChange): number | null {
  return "dailyBudgetMinor" in change ? change.dailyBudgetMinor : null;
}

async function verifyStoredTarget(db: PrismaClient, row: {
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
  targetType: string;
  targetId: string;
  expectedState: string;
  sourceSyncRunId: string | null;
}): Promise<{ expected: MetaActionExpectedState; current: { status: string; dailyBudgetMinor: number | null } }> {
  if (!validTargetType(row.targetType)) throw new MetaActionError("validation", "Stored Meta action target type is invalid");
  const expected = parseExpectedState(row.expectedState);
  if (!expected) throw new MetaActionError("validation", "Stored Meta action expected state is invalid");
  const latest = await db.syncRun.findFirst({
    where: { accountId: row.accountId, campaignId: row.campaignId, attributionKey: row.attributionKey, status: "SUCCEEDED" },
    orderBy: [{ finishedAt: "desc" }, { startedAt: "desc" }],
    select: { id: true },
  });
  if (!latest || row.sourceSyncRunId !== latest.id) throw new MetaActionError("stale", "The target has changed since this action was proposed; prepare a fresh action");
  const target = row.targetType === "ad"
    ? await db.ad.findUnique({ where: { metaId: row.targetId } })
    : await db.adSet.findUnique({ where: { metaId: row.targetId } });
  if (!target || target.lastSeenSyncRunId !== latest.id) throw new MetaActionError("stale", "The target is not current in the latest successful stored Meta sync");
  assertTargetCampaign(target, row.campaignId);
  const current = currentStoredState(target);
  if (current.status !== expected.status || current.dailyBudgetMinor !== expected.dailyBudgetMinor) throw new MetaActionError("stale", "The durable target state changed after approval; prepare a fresh action");
  return { expected, current };
}

function validateStoredChange(row: { action: string; targetType: string; requestedChange: string }, expected: MetaActionExpectedState, config: MetaActionConfig): { action: MetaActionKind; requested: MetaActionChange } {
  if (!validAction(row.action) || !validTargetType(row.targetType)) throw new MetaActionError("validation", "Stored Meta action is not allowlisted");
  const requested = parseRequestedChange(row.requestedChange);
  if (!requested) throw new MetaActionError("validation", "Stored Meta action requested change is invalid");
  if ((row.action === "pause_ad" || row.action === "resume_ad") && (row.targetType !== "ad" || !requestStatusFor(requested))) throw new MetaActionError("validation", "Stored ad status action is invalid");
  if (row.action === "pause_ad" && requestStatusFor(requested) !== "PAUSED") throw new MetaActionError("validation", "Pause action must request PAUSED");
  if (row.action === "resume_ad" && requestStatusFor(requested) !== "ACTIVE") throw new MetaActionError("validation", "Resume action must request ACTIVE");
  if (row.action === "pause_ad" && expected.status !== "ACTIVE") throw new MetaActionError("validation", "Pause action requires an active approved state");
  if (row.action === "resume_ad" && expected.status !== "PAUSED") throw new MetaActionError("validation", "Resume action requires a paused approved state");
  const requestedBudget = requestBudgetFor(requested);
  if (row.action === "set_adset_daily_budget" && (row.targetType !== "adset" || requestedBudget == null || expected.dailyBudgetMinor == null || !budgetWithinLimits(requestedBudget, expected.dailyBudgetMinor, config) || requestedBudget <= expected.dailyBudgetMinor)) {
    throw new MetaActionError("validation", "Stored ad-set budget action is outside the configured safety bounds");
  }
  return { action: row.action, requested };
}

/** Execute one approved action with one provider POST at most and no retries. */
export async function executeMetaAction(db: PrismaClient, id: string, options: { env?: ActionEnvironment; provider?: MetaActionProvider; fetchImpl?: typeof fetch; actor?: string; now?: Date } = {}): Promise<MetaActionResult> {
  const config = loadMetaActionConfig(options.env);
  if (!config.accountId) throw new MetaActionError("configuration", "META_AD_ACCOUNT_ID is required before executing Meta actions");
  await recoverStaleExecutingActions(db, { accountId: config.accountId }, options.now ?? new Date());
  const initial = await readActionForAccount(db, id, config.accountId, config);
  if (initial.status === "EXECUTED") return { action: parseActionRow(initial), duplicate: true };
  if (initial.status === "FAILED") throw new MetaActionError("conflict", "This Meta action failed and cannot be retried; prepare a fresh action", parseActionRow(initial));
  if (initial.status === "EXECUTING") throw new MetaActionError("conflict", "This Meta action is already executing; no automatic retry is allowed", parseActionRow(initial));
  if (initial.status !== "APPROVED") throw new MetaActionError("conflict", "Only an approved Meta action can execute", parseActionRow(initial));
  if (!config.requestedWritesEnabled) throw new MetaActionError("disabled", "Meta writes are disabled; no provider call was made", parseActionRow(initial));
  if (!config.writesEnabled) throw new MetaActionError("configuration", "Meta writes are not safely configured; no provider call was made", parseActionRow(initial));

  const now = options.now ?? new Date();
  const claimed = await db.metaAction.updateMany({ where: { id, accountId: config.accountId, campaignId: config.campaignId, attributionKey: config.attributionKey, status: "APPROVED" }, data: { status: "EXECUTING", executingAt: now, error: null } });
  if (claimed.count === 0) {
    const current = await readActionForAccount(db, id, config.accountId, config);
    if (current.status === "EXECUTED") return { action: parseActionRow(current), duplicate: true };
    throw new MetaActionError("conflict", "Meta action was claimed by another execution", parseActionRow(current));
  }
  const row = await readActionForAccount(db, id, config.accountId, config);
  let parsed: { action: MetaActionKind; requested: MetaActionChange };
  let expectedTarget: { expected: MetaActionExpectedState; current: { status: string; dailyBudgetMinor: number | null } };
  try {
    parsed = validateStoredChange(row, parseExpectedState(row.expectedState) ?? { status: "", dailyBudgetMinor: null }, config);
    expectedTarget = await verifyStoredTarget(db, row);
    if (parsed.action === "set_adset_daily_budget" && requestBudgetFor(parsed.requested) === expectedTarget.current.dailyBudgetMinor) throw new MetaActionError("stale", "The ad-set already has the requested budget; prepare a fresh action");
    if ((parsed.action === "pause_ad" || parsed.action === "resume_ad") && requestStatusFor(parsed.requested) === expectedTarget.current.status) throw new MetaActionError("stale", "The ad already has the requested status; prepare a fresh action");
  } catch (error) {
    const action = await failClaimedAction(db, row, { message: error instanceof MetaActionError ? error.message : "Meta action validation failed; no mutation was attempted.", now, actor: options.actor ?? "operator" });
    throw new MetaActionError(error instanceof MetaActionError ? error.code : "validation", error instanceof MetaActionError ? error.message : "Meta action validation failed; no mutation was attempted.", action);
  }

  const provider = options.provider ?? createDefaultMetaActionProvider(config, options.env, options.fetchImpl);
  const actor = options.actor ?? "operator";
  let live: LiveAdState;
  try {
    live = row.targetType === "ad" ? await provider.readAd(row.targetId) : await provider.readAdSet(row.targetId);
  } catch (error) {
    const action = await failClaimedAction(db, row, { message: providerErrorMessage(error, "read"), traceId: providerTrace(error), now, actor });
    throw new MetaActionError("provider", providerErrorMessage(error, "read"), action);
  }
  const expected = expectedTarget.expected;
  if (!live || live.id !== row.targetId || !sameAccount(live.accountId, row.accountId)) {
    const action = await failClaimedAction(db, row, { message: "Meta target account or id could not be verified; no mutation was attempted.", now, actor });
    throw new MetaActionError("verification", "Meta target account or id could not be verified; no mutation was attempted.", action);
  }
  if ((row.campaignId && live.campaignId !== row.campaignId) || live.status !== expected.status || (row.targetType === "adset" && live.dailyBudgetMinor !== expected.dailyBudgetMinor)) {
    const action = await failClaimedAction(db, row, { message: "The live Meta target differs from the approved state; no mutation was attempted.", now, actor });
    throw new MetaActionError("stale", "The live Meta target differs from the approved state; no mutation was attempted.", action);
  }

  const oldValue: MetaActionStoredValue = row.targetType === "ad" ? { status: live.status } : { dailyBudgetMinor: live.dailyBudgetMinor as number };
  let reference: MetaMutationReference;
  try {
    reference = row.action === "set_adset_daily_budget"
      ? await provider.updateAdSetDailyBudget(row.targetId, requestBudgetFor(parsed.requested) as number)
      : await provider.updateAdStatus(row.targetId, requestStatusFor(parsed.requested) as MetaAdStatus);
    reference = normaliseReference(reference, row.targetId);
  } catch (error) {
    const action = await failClaimedAction(db, row, { message: providerErrorMessage(error, "write"), oldValue, traceId: providerTrace(error), now, actor });
    throw new MetaActionError("provider", providerErrorMessage(error, "write"), action);
  }

  let verified: LiveAdState;
  try {
    verified = row.targetType === "ad" ? await provider.readAd(row.targetId) : await provider.readAdSet(row.targetId);
  } catch (error) {
    const action = await failClaimedAction(db, row, { message: providerErrorMessage(error, "verify"), oldValue, reference, traceId: providerTrace(error), now, actor });
    throw new MetaActionError("verification", providerErrorMessage(error, "verify"), action);
  }
  const desiredStatus = requestStatusFor(parsed.requested);
  const desiredBudget = requestBudgetFor(parsed.requested);
  const verifiedCorrectly = verified.id === row.targetId
    && sameAccount(verified.accountId, row.accountId)
    && (desiredStatus == null || verified.status === desiredStatus)
    && (desiredBudget == null || verified.dailyBudgetMinor === desiredBudget);
  if (!verifiedCorrectly) {
    const action = await failClaimedAction(db, row, { message: "Meta mutation could not be verified; no automatic retry was attempted.", oldValue, reference, now, actor });
    throw new MetaActionError("verification", "Meta mutation could not be verified; no automatic retry was attempted.", action);
  }
  const newValue: MetaActionChange = desiredStatus == null ? { dailyBudgetMinor: verified.dailyBudgetMinor as number } : { status: desiredStatus };
  try {
    return { action: await completeClaimedAction(db, row, oldValue, newValue, reference, now, actor), duplicate: false };
  } catch (error) {
    // A verified provider mutation must never be left looking retryable. The
    // recovery path records a terminal failure with the verified new value,
    // reference and a safe audit row. It deliberately does not retry Meta.
    let recovered: MetaActionView;
    try {
      recovered = await failClaimedAction(db, row, {
        message: "Meta mutation was verified but final audit persistence failed; the action is terminal and must be reconciled manually.",
        oldValue,
        newValue,
        reference,
        now,
        actor,
      });
    } catch (recoveryError) {
      console.error("Meta action final audit recovery failed:", recoveryError instanceof Error ? recoveryError.name : "unknown error");
      throw new MetaActionError("verification", "Meta mutation was verified but final audit persistence could not be confirmed; do not retry automatically");
    }
    void error;
    throw new MetaActionError("verification", "Meta mutation was verified but final audit persistence failed; do not retry automatically", recovered);
  }
}

function parseMinorUnit(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

async function readMetaResponse(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text()) as unknown;
  } catch {
    return undefined;
  }
}

function graphErrorBody(body: unknown): boolean {
  return isRecord(body) && isRecord(body.error);
}

function liveObject(body: unknown, targetId: string, targetType: MetaActionTargetType): LiveAdState {
  if (!isRecord(body) || typeof body.id !== "string" || body.id !== targetId || typeof body.account_id !== "string") {
    throw new MetaActionProviderError("Meta target response was incomplete");
  }
  // `status` is the configured status changed by the write endpoint;
  // `effective_status` can additionally reflect policy, review or parent
  // delivery state and must not be used as the write-after-read value.
  const status = stringValue(body.status);
  if (!status) throw new MetaActionProviderError("Meta target response did not include a status");
  const campaignId = stringValue(body.campaign_id);
  const rawBudget = body.daily_budget;
  const dailyBudgetMinor = targetType === "adset"
    ? rawBudget == null ? null : parseMinorUnit(rawBudget)
    : null;
  if (targetType === "adset" && rawBudget != null && dailyBudgetMinor == null) throw new MetaActionProviderError("Meta ad-set response included an invalid daily budget");
  return { id: body.id, accountId: body.account_id, status, dailyBudgetMinor, campaignId };
}

/** Default provider: reads use the resilient GET client; writes are one POST with no retry. */
const ACTION_READ_TIMEOUT_MS = 10_000;

function createDefaultMetaActionProvider(config: MetaActionConfig, env: ActionEnvironment = process.env, fetchImpl: typeof fetch = fetch): MetaActionProvider {
  const token = env.META_MARKETING_TOKEN?.trim();
  if (!token || !config.accountId) throw new MetaConfigurationError("Meta action provider is not configured");
  const client = new MetaClient({ token, adAccountId: config.accountId, graphVersion: config.graphVersion, timeoutMs: ACTION_READ_TIMEOUT_MS, maxRetries: 0, fetchImpl });
  const read = async (id: string, targetType: MetaActionTargetType): Promise<LiveAdState> => {
    if (!validMetaObjectId(id)) throw new MetaActionProviderError("Meta target id is invalid");
    const result = await client.request<unknown>(id, { fields: targetType === "adset" ? "id,account_id,status,effective_status,campaign_id,daily_budget" : "id,account_id,status,effective_status,campaign_id" });
    return liveObject(result.data, id, targetType);
  };
  const mutate = async (id: string, params: Record<string, string>): Promise<MetaMutationReference> => {
    if (!validMetaObjectId(id)) throw new MetaActionProviderError("Meta target id is invalid");
    if (!config.requestedWritesEnabled) throw new MetaActionProviderError("Meta writes are disabled; no provider call was made");
    if (!config.writesEnabled) throw new MetaActionProviderError("Meta writes are not safely configured; no provider call was made");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/${id}`, {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal: controller.signal,
      });
      const traceId = response.headers.get("x-fb-trace-id") ?? undefined;
      const revision = response.headers.get("x-fb-rev") ?? undefined;
      const body = await readMetaResponse(response);
      if (!response.ok || !isRecord(body) || body.success !== true || graphErrorBody(body)) {
        throw new MetaActionProviderError("Meta mutation request failed", { traceId });
      }
      return { objectId: id, traceId, revision };
    } catch (error) {
      if (error instanceof MetaActionProviderError) throw error;
      throw new MetaActionProviderError(controller.signal.aborted ? "Meta mutation request timed out" : "Meta mutation request failed", { traceId: responseTrace(error) });
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    readAd: (id) => read(id, "ad"),
    readAdSet: (id) => read(id, "adset"),
    updateAdStatus: (id, status) => mutate(id, { status }),
    updateAdSetDailyBudget: (id, dailyBudgetMinor) => mutate(id, { daily_budget: String(dailyBudgetMinor) }),
  };
}

function responseTrace(error: unknown): string | undefined {
  return error instanceof MetaActionProviderError ? error.traceId : undefined;
}

/** Read a redacted, validated list for the dashboard. Missing old tables are treated as unavailable, not fatal. */
export async function readMetaActionViews(db: PrismaClient, accountId: string | null, scope: MetaActionScope = loadMetaActionConfig(), limit = 50): Promise<MetaActionView[]> {
  if (!accountId) return [];
  try {
    await recoverStaleExecutingActions(db, { accountId }, new Date());
    const rows = await db.metaAction.findMany({ where: { accountId, campaignId: scope.campaignId, attributionKey: scope.attributionKey }, orderBy: { createdAt: "desc" }, take: Math.min(100, Math.max(1, limit)) });
    const views: MetaActionView[] = [];
    for (const row of rows) {
      try {
        views.push(parseActionRow(row));
      } catch {
        console.error("Stored Meta action failed validation and was omitted", row.id);
      }
    }
    return views;
  } catch (error) {
    if (isMissingMetaActionTableError(error)) return [];
    throw new MetaActionError("verification", "Meta action records could not be read; no provider mutation was attempted.");
  }
}
