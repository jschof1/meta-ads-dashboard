import type { HighLevelPipeline } from "@/lib/highlevel";
import type { HighLevelSettings, HighLevelStageKey } from "@/lib/highlevel-config";

export const ATTRIBUTION_GRANULARITIES = ["ad", "campaign", "paid-meta", "unattributed"] as const;
export type AttributionGranularity = (typeof ATTRIBUTION_GRANULARITIES)[number];
export type CrmSemanticStage = HighLevelStageKey | "wonCustomer" | "lost";

export type NormalizedCrmContact = {
  highLevelId: string;
  locationId: string;
  dateAdded: string | null;
  dateUpdated: string | null;
  attributionGranularity: AttributionGranularity;
  metaAdId: string | null;
  metaCampaignId: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  clickIds: Record<string, string>;
  attribution: Record<string, string>;
};

export type NormalizedCrmOpportunity = {
  highLevelId: string;
  locationId: string;
  contactId: string | null;
  pipelineId: string;
  pipelineStageId: string | null;
  status: string;
  semanticStage: CrmSemanticStage | null;
  valueMajorUnits: number | null;
  createdAtProvider: string | null;
  updatedAtProvider: string | null;
  lastStageChangeAt: string | null;
  lastStatusChangeAt: string | null;
};

const MAX_ID_LENGTH = 256;
const MAX_VALUE_LENGTH = 800;
const CLICK_KEYS = ["fbclid", "fbc", "fbp", "fbEventId", "gclid", "msclkid"] as const;
const ATTRIBUTION_KEYS = [
  "source",
  "medium",
  "campaign",
  "content",
  "term",
  "referrer",
  "landingPage",
  "sessionSource",
  "sessionMedium",
  ...CLICK_KEYS,
] as const;
const META_AD_ID_KEYS = ["metaAdId", "meta_ad_id", "facebookAdId", "facebook_ad_id", "adId", "ad_id"] as const;
const META_CAMPAIGN_ID_KEYS = ["metaCampaignId", "meta_campaign_id", "facebookCampaignId", "facebook_campaign_id", "campaignId", "campaign_id"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = MAX_VALUE_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maximum) : null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return null;
}

function field(value: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  }
  return undefined;
}

function isoDate(value: unknown): string | null {
  const candidate = text(value, 120);
  if (!candidate) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? candidate
      : null;
  }
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function customFieldValues(raw: Record<string, unknown>): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const candidates = [raw.customFields, raw.custom_fields, raw.customField];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!isObject(item)) continue;
        const id = firstText(item.id, item.fieldId, item.field_id);
        if (id) values.set(id, field(item, "value", "fieldValue", "field_value"));
      }
    } else if (isObject(candidate)) {
      for (const [id, value] of Object.entries(candidate)) values.set(id, value);
    }
  }
  return values;
}

function attributionSources(raw: Record<string, unknown>): Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  if (Array.isArray(raw.attributions)) values.push(...raw.attributions.filter(isObject));
  for (const candidate of [raw.attributionSource, raw.attribution, raw.attribution_source]) {
    if (isObject(candidate)) values.push(candidate);
  }
  values.push(raw);
  return values;
}

function readAttribution(raw: Record<string, unknown>): Record<string, string> {
  const sources = attributionSources(raw);
  const result: Record<string, string> = {};
  for (const key of ATTRIBUTION_KEYS) {
    const capitalised = key[0].toUpperCase() + key.slice(1);
    const aliases = [
      key,
      capitalised,
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
      `utm${capitalised}`,
      `utm_${key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`,
    ];
    for (const source of sources) {
      const candidate = firstText(...aliases.map((alias) => source[alias]));
      if (candidate) {
        result[key] = candidate.slice(0, MAX_VALUE_LENGTH);
        break;
      }
    }
  }
  return result;
}

function explicitMetaId(sources: Record<string, unknown>[], keys: readonly string[]): string | null {
  for (const source of sources) {
    const candidate = firstText(...keys.map((key) => source[key]));
    if (candidate) return candidate.slice(0, MAX_ID_LENGTH);
  }
  return null;
}

function clickIds(attribution: Record<string, string>): Record<string, string> {
  return Object.fromEntries(CLICK_KEYS
    .filter((key) => attribution[key])
    .map((key) => [key, attribution[key].slice(0, MAX_ID_LENGTH)]));
}

function metaPaidSource(attribution: Record<string, string>): boolean {
  const source = attribution.source?.toLowerCase();
  const medium = attribution.medium?.toLowerCase();
  const knownSources = new Set(["meta", "facebook", "instagram", "fb", "fb_ad", "facebook_ads", "instagram_ads", "meta_ads", "facebook.com", "instagram.com"]);
  const explicitPaidSources = new Set(["fb_ad", "facebook_ads", "instagram_ads", "meta_ads"]);
  const knownMediums = new Set(["paid_social", "paid-social", "social_paid", "meta_paid"]);
  const hasMetaClickId = CLICK_KEYS.some((key) => attribution[key]);
  return (source != null && explicitPaidSources.has(source))
    || (source != null && knownSources.has(source) && medium != null && knownMediums.has(medium))
    || (source != null && knownSources.has(source) && hasMetaClickId);
}

function contactId(raw: Record<string, unknown>): string | null {
  return firstText(raw.id, raw.contactId, raw.contact_id)?.slice(0, MAX_ID_LENGTH) ?? null;
}

export function normalizeContact(raw: Record<string, unknown>, config: HighLevelSettings): NormalizedCrmContact | null {
  const highLevelId = contactId(raw);
  if (!highLevelId || !config.locationId) return null;
  const locationId = firstText(raw.locationId, raw.location_id);
  if (!locationId || locationId !== config.locationId) return null;
  const attribution = readAttribution(raw);
  const sources = attributionSources(raw);
  const customFields = customFieldValues(raw);
  const metaAdId = (config.metaAdIdFieldId
    ? text(customFields.get(config.metaAdIdFieldId), MAX_ID_LENGTH)
    : null) ?? explicitMetaId(sources, META_AD_ID_KEYS);
  const metaCampaignId = (config.metaCampaignIdFieldId
    ? text(customFields.get(config.metaCampaignIdFieldId), MAX_ID_LENGTH)
    : null) ?? explicitMetaId(sources, META_CAMPAIGN_ID_KEYS);
  const attributionGranularity: AttributionGranularity = metaAdId
    ? "ad"
    : metaCampaignId
      ? "campaign"
      : metaPaidSource(attribution)
        ? "paid-meta"
        : "unattributed";

  return {
    highLevelId,
    locationId,
    dateAdded: isoDate(field(raw, "dateAdded", "date_added", "createdAt", "created_at")),
    dateUpdated: isoDate(field(raw, "dateUpdated", "date_updated", "updatedAt", "updated_at")),
    attributionGranularity,
    metaAdId,
    metaCampaignId,
    utmSource: attribution.source ?? null,
    utmMedium: attribution.medium ?? null,
    utmCampaign: attribution.campaign ?? null,
    utmContent: attribution.content ?? null,
    clickIds: clickIds(attribution),
    attribution,
  };
}

function opportunityId(raw: Record<string, unknown>): string | null {
  return firstText(raw.id, raw.opportunityId, raw.opportunity_id)?.slice(0, MAX_ID_LENGTH) ?? null;
}

function amount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nestedContactId(raw: Record<string, unknown>): string | null {
  const contact = isObject(raw.contact) ? raw.contact : null;
  return firstText(raw.contactId, raw.contact_id, contact?.id)?.slice(0, MAX_ID_LENGTH) ?? null;
}

export function normalizeOpportunity(
  raw: Record<string, unknown>,
  config: HighLevelSettings,
): NormalizedCrmOpportunity | null {
  const highLevelId = opportunityId(raw);
  if (!highLevelId || !config.locationId || !config.pipelineId) return null;
  const locationId = firstText(raw.locationId, raw.location_id);
  const pipelineId = firstText(raw.pipelineId, raw.pipeline_id);
  if (locationId !== config.locationId || pipelineId !== config.pipelineId) return null;
  const status = firstText(raw.status, raw.opportunityStatus, raw.opportunity_status);
  if (!status) return null;
  const pipelineStageId = firstText(raw.pipelineStageId, raw.pipeline_stage_id, raw.stageId, raw.stage_id)?.slice(0, MAX_ID_LENGTH) ?? null;
  let semanticStage: CrmSemanticStage | null = null;
  if (status === config.wonStatus) semanticStage = "wonCustomer";
  else if (status === config.lostStatus) semanticStage = "lost";
  else if (status === "open" && pipelineStageId) {
    const stageEntry = (Object.entries(config.stageIds) as [HighLevelStageKey, string | null][]).find(([, id]) => id === pipelineStageId);
    semanticStage = stageEntry?.[0] ?? null;
  }

  return {
    highLevelId,
    locationId,
    contactId: nestedContactId(raw),
    pipelineId,
    pipelineStageId,
    status,
    semanticStage,
    valueMajorUnits: amount(field(raw, "monetaryValue", "monetary_value", "value")),
    createdAtProvider: isoDate(field(raw, "createdAt", "created_at", "dateAdded", "date_added")),
    updatedAtProvider: isoDate(field(raw, "updatedAt", "updated_at", "dateUpdated", "date_updated")),
    lastStageChangeAt: isoDate(field(raw, "lastStageChangeAt", "last_stage_change_at")),
    lastStatusChangeAt: isoDate(field(raw, "lastStatusChangeAt", "last_status_change_at")),
  };
}

export function validatePipelineMapping(pipeline: HighLevelPipeline, config: HighLevelSettings): string[] {
  const errors: string[] = [];
  if (!config.locationId || pipeline.locationId !== config.locationId) errors.push("HighLevel pipeline location does not match configuration");
  if (!config.pipelineId || pipeline.id !== config.pipelineId) errors.push("HighLevel pipeline id does not match configuration");
  const stageIds = new Set(pipeline.stages.map((stage) => stage.id));
  for (const [key, id] of Object.entries(config.stageIds)) {
    if (!id || !stageIds.has(id)) errors.push(`Configured HighLevel ${key} stage was not found in the pipeline`);
  }
  return errors;
}
