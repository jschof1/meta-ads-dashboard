import { createHash } from "node:crypto";

type Environment = Record<string, string | undefined>;

export const HIGHLEVEL_BASE_URL = "https://services.leadconnectorhq.com";
export const HIGHLEVEL_API_VERSION = "v3" as const;
export const HIGHLEVEL_STAGE_KEYS = [
  "lead",
  "contacted",
  "qualified",
  "callBooked",
  "callAttended",
] as const;

export type HighLevelStageKey = (typeof HIGHLEVEL_STAGE_KEYS)[number];
export type HighLevelStageIds = Record<HighLevelStageKey, string | null>;
export type HighLevelConfigStatus = "not_configured" | "misconfigured" | "disabled" | "configured";

export type HighLevelSettings = {
  token: string | null;
  locationId: string | null;
  apiVersion: typeof HIGHLEVEL_API_VERSION;
  syncEnabled: boolean;
  pipelineId: string | null;
  stageIds: HighLevelStageIds;
  wonStatus: string | null;
  lostStatus: string | null;
  metaAdIdFieldId: string | null;
  metaCampaignIdFieldId: string | null;
  currencyCode: string | null;
  leaseSeconds: number;
  maxRecords: number;
  mappingReady: boolean;
  providerReady: boolean;
  revenueReady: boolean;
  status: HighLevelConfigStatus;
  errors: string[];
  mappingHash: string | null;
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_LEASE_SECONDS = 900;
const DEFAULT_MAX_RECORDS = 10_000;
const MAX_RECORDS_LIMIT = 50_000;

function value(env: Environment, key: string): string | null {
  const candidate = env[key]?.trim();
  return candidate ? candidate : null;
}

function parsePositiveInteger(env: Environment, key: string, fallback: number, maximum: number): number {
  const raw = value(env, key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function validId(candidate: string | null, label: string, errors: string[]): string | null {
  if (candidate == null) {
    errors.push(`${label} is required`);
    return null;
  }
  if (!ID_PATTERN.test(candidate)) {
    errors.push(`${label} must use only letters, numbers, underscores or hyphens`);
    return null;
  }
  return candidate;
}

function validOptionalId(candidate: string | null, label: string, errors: string[]): string | null {
  if (candidate == null) return null;
  if (!ID_PATTERN.test(candidate)) {
    errors.push(`${label} must use only letters, numbers, underscores or hyphens`);
    return null;
  }
  return candidate;
}

function hashMapping(input: {
  locationId: string;
  pipelineId: string;
  stageIds: HighLevelStageIds;
  wonStatus: string;
  lostStatus: string;
  metaAdIdFieldId: string | null;
  metaCampaignIdFieldId: string | null;
  currencyCode: string | null;
}): string {
  // Deliberately excludes the token. A token rotation must not invalidate a
  // stored snapshot or make an otherwise identical mapping look new.
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export function loadHighLevelSettings(env: Environment = process.env): HighLevelSettings {
  const errors: string[] = [];
  const token = value(env, "HIGHLEVEL_TOKEN");
  const locationId = validId(value(env, "HIGHLEVEL_LOCATION_ID"), "HIGHLEVEL_LOCATION_ID", errors);
  const pipelineId = validId(value(env, "HIGHLEVEL_PIPELINE_ID"), "HIGHLEVEL_PIPELINE_ID", errors);
  const apiVersion = value(env, "HIGHLEVEL_API_VERSION") ?? HIGHLEVEL_API_VERSION;
  if (apiVersion !== HIGHLEVEL_API_VERSION) errors.push(`HIGHLEVEL_API_VERSION must be ${HIGHLEVEL_API_VERSION}`);

  const stageIds = Object.fromEntries(HIGHLEVEL_STAGE_KEYS.map((key) => {
    const envKey = highLevelStageIdEnvKey(key);
    return [key, validId(value(env, envKey), envKey, errors)];
  })) as HighLevelStageIds;
  const configuredStageIds = Object.values(stageIds).filter((id): id is string => id != null);
  if (new Set(configuredStageIds).size !== configuredStageIds.length) {
    errors.push("HighLevel funnel stage IDs must be distinct");
  }
  const wonStatus = value(env, "HIGHLEVEL_WON_STATUS");
  const lostStatus = value(env, "HIGHLEVEL_LOST_STATUS");
  if (!wonStatus) errors.push("HIGHLEVEL_WON_STATUS is required");
  if (!lostStatus) errors.push("HIGHLEVEL_LOST_STATUS is required");
  if (wonStatus && lostStatus && wonStatus === lostStatus) errors.push("HIGHLEVEL_WON_STATUS and HIGHLEVEL_LOST_STATUS must differ");

  const metaAdIdFieldId = validOptionalId(value(env, "HIGHLEVEL_META_AD_ID_FIELD_ID"), "HIGHLEVEL_META_AD_ID_FIELD_ID", errors);
  const metaCampaignIdFieldId = validOptionalId(value(env, "HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID"), "HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID", errors);
  if (metaAdIdFieldId && metaAdIdFieldId === metaCampaignIdFieldId) {
    errors.push("HIGHLEVEL_META_AD_ID_FIELD_ID and HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID must differ");
  }
  const currencyCode = value(env, "HIGHLEVEL_CURRENCY_CODE")?.toUpperCase() ?? null;
  if (currencyCode && !/^[A-Z]{3}$/.test(currencyCode)) errors.push("HIGHLEVEL_CURRENCY_CODE must be a three-letter ISO currency code");
  const syncEnabledValue = value(env, "HIGHLEVEL_SYNC_ENABLED");
  if (syncEnabledValue && syncEnabledValue !== "true" && syncEnabledValue !== "false") {
    errors.push("HIGHLEVEL_SYNC_ENABLED must be true or false");
  }
  const syncEnabled = syncEnabledValue === "true";
  const leaseSeconds = parsePositiveInteger(env, "HIGHLEVEL_SYNC_LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 86_400);
  const maxRecords = parsePositiveInteger(env, "HIGHLEVEL_MAX_RECORDS", DEFAULT_MAX_RECORDS, MAX_RECORDS_LIMIT);
  const mappingReady = errors.length === 0
    && locationId != null
    && pipelineId != null
    && HIGHLEVEL_STAGE_KEYS.every((key) => stageIds[key] != null)
    && wonStatus != null
    && lostStatus != null;
  const providerReady = mappingReady && token != null && syncEnabled;
  const revenueReady = mappingReady && currencyCode != null;
  const mappingHash = mappingReady
    ? hashMapping({
      locationId: locationId as string,
      pipelineId: pipelineId as string,
      stageIds,
      wonStatus: wonStatus as string,
      lostStatus: lostStatus as string,
      metaAdIdFieldId,
      metaCampaignIdFieldId,
      currencyCode,
    })
    : null;

  const hasAnySetting = [
    token,
    locationId,
    pipelineId,
    wonStatus,
    lostStatus,
    metaAdIdFieldId,
    metaCampaignIdFieldId,
    currencyCode,
    ...Object.values(stageIds),
  ].some(Boolean);
  let status: HighLevelConfigStatus;
  if (!hasAnySetting) {
    status = "not_configured";
  } else if (errors.length > 0 || (mappingReady && !token)) {
    status = "misconfigured";
  } else if (mappingReady && !syncEnabled) {
    status = "disabled";
  } else {
    status = "configured";
  }

  return {
    token,
    locationId,
    apiVersion: HIGHLEVEL_API_VERSION,
    syncEnabled,
    pipelineId,
    stageIds,
    wonStatus,
    lostStatus,
    metaAdIdFieldId,
    metaCampaignIdFieldId,
    currencyCode,
    leaseSeconds,
    maxRecords,
    mappingReady,
    providerReady,
    revenueReady,
    status,
    errors: errors.slice(0, 20),
    mappingHash,
  };
}

export function highLevelStageIdEnvKey(key: HighLevelStageKey): string {
  return `HIGHLEVEL_STAGE_${key === "callBooked" ? "CALL_BOOKED" : key === "callAttended" ? "CALL_ATTENDED" : key.toUpperCase()}_ID`;
}
