import type { PrismaClient } from "@prisma/client";
import {
  createMetaClient,
  toOptionalMinorUnits,
  toOptionalFloat,
  toOptionalInt,
  type AdSummary,
  type MetaAdSet,
  type MetaAccount,
  type MetaCampaign,
  type MetaCreative,
  type MetaInsightDateRange,
  type MetaInsightLevel,
  type MetaInsightRow,
  type MetaResultEventDiagnostic,
  type MetaClient,
} from "@/lib/meta";
import { chooseSyncRange, isDateInRange, isValidTimeZone, type SyncRange } from "@/lib/periods";
import { safeJson } from "@/lib/safe-json";
import { buildDashboardState } from "@/lib/read-model";
import { persistRecommendationLifecycle } from "@/lib/recommendation-store";

export type SyncTrigger = "cron" | "manual";

type SyncClient = Pick<
  MetaClient,
  | "getAccount"
  | "listCampaigns"
  | "listAdSets"
  | "listAds"
  | "listCreatives"
  | "getDailyInsights"
  | "getAccountId"
  | "getGraphVersion"
  | "getAttributionKey"
  | "getDiagnostics"
  | "diagnoseResultEvents"
>;

export class SyncAlreadyRunningError extends Error {
  readonly name = "SyncAlreadyRunningError";

  constructor() {
    super("A Meta sync is already running for this account");
  }
}

class SyncLeaseLostError extends Error {
  readonly name = "SyncLeaseLostError";

  constructor() {
    super("The Meta sync lease was lost before its data could be committed");
  }
}

export type NormalizedDailyInsight = {
  date: string;
  level: MetaInsightLevel;
  entityId: string;
  attributionKey: string;
  currencyCode: string | null;
  spendMinorUnits: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  leads: number | null;
  cplMinorUnits: number | null;
  cpcMinorUnits: number | null;
  cpmMinorUnits: number | null;
  ctrLink: number | null;
  frequency: number | null;
  resultActionType: string | null;
  rawActions: string;
  raw: string;
};

export type SyncResult = {
  runId: string;
  status: "SUCCEEDED";
  initialBackfill: boolean;
  since: string;
  until: string;
  rowsFetched: number;
  rowsWritten: number;
  warning: string | null;
};

export type SyncOptions = {
  db?: PrismaClient;
  client?: SyncClient;
  trigger?: SyncTrigger;
  now?: Date;
  initialBackfillDays?: number;
  recentRefreshDays?: number;
  leaseSeconds?: number;
  // Injectable only for deterministic tests; production uses the wall clock.
  clock?: () => Date;
};

type EntityDiscovery = {
  account: MetaAccount;
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: AdSummary[];
  creatives: MetaCreative[];
};

const INSIGHT_LEVELS: MetaInsightLevel[] = ["account", "campaign", "adset", "ad"];
const SYNC_TRANSACTION_TIMEOUT_MS = 45_000;

function json(value: unknown, fallback = "{}"): string {
  return safeJson(value, fallback);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalDateTime(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function hasProviderFields(value: object): boolean {
  return Object.keys(value).some((key) => key !== "id" && key !== "raw");
}

function hasProviderField(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

const CURRENT_METADATA_FIELDS = {
  campaign: {
    required: ["name", "objective", "status", "effective_status", "updated_time"],
    alternatives: [["daily_budget", "lifetime_budget"]],
  },
  adSet: {
    required: ["campaign_id", "name", "status", "effective_status", "learning_stage_info", "updated_time"],
    alternatives: [["daily_budget", "lifetime_budget"]],
  },
  ad: {
    required: ["name", "status", "effective_status", "campaign_id", "adset_id", "creative_id", "updated_time"],
    alternatives: [],
  },
  creative: {
    required: [
      "name",
      "title",
      "body",
      "call_to_action_type",
      "thumbnail_url",
      "image_hash",
      "image_url",
      "video_id",
      "object_id",
      "link_url",
      "object_url",
      "asset_feed_spec",
      "url_tags",
      "updated_time",
    ],
    alternatives: [],
  },
} as const;

function hasCompleteProviderMetadata(
  value: object,
  fields: { required: readonly string[]; alternatives: readonly (readonly string[])[] },
): boolean {
  return fields.required.every((field) => hasProviderField(value, field))
    && fields.alternatives.every((group) => group.some((field) => hasProviderField(value, field)));
}

function configuredCampaignId(): string | undefined {
  const value = process.env.META_CAMPAIGN_ID?.trim();
  return value || undefined;
}

function canonicalAccountId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeErrorMessage(error: unknown): string {
  const source = error instanceof Error ? error.message : String(error);
  const secrets: string[] = [
    process.env.META_MARKETING_TOKEN,
    process.env.TURSO_AUTH_TOKEN,
    process.env.ANTHROPIC_API_KEY,
    process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN,
  ].filter((secret): secret is string => Boolean(secret));
  return secrets
    .reduce((message, secret) => message.replaceAll(secret, "[REDACTED]"), source)
    .replace(/(access[_-]?token|authorization|api[_-]?key|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 2_000);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function learningStage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  for (const key of ["status", "phase", "learning_stage"]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function creativeFormat(creative: MetaCreative): string | null {
  if (creative.video_id) return "video";
  if (creative.image_hash || creative.image_url || creative.thumbnail_url) return "image";
  if (creative.asset_feed_spec) return "dynamic";
  return null;
}

function entityIdFor(level: MetaInsightLevel, row: MetaInsightRow, accountId: string): string | null {
  switch (level) {
    case "account":
      return row.account_id ? canonicalAccountId(row.account_id) : accountId;
    case "campaign":
      return row.campaign_id || null;
    case "adset":
      return row.adset_id || null;
    case "ad":
      return row.ad_id || null;
  }
}

function metricOrDerived(
  direct: number | null,
  numerator: number | null,
  denominator: number | null,
  multiplier = 1,
): number | null {
  if (direct !== null) return direct;
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * multiplier);
}

function normalizeInsight(
  row: MetaInsightRow,
  level: MetaInsightLevel,
  accountId: string,
  currencyCode: string | null,
  attributionKey: string,
  range: SyncRange,
  client: Pick<SyncClient, "diagnoseResultEvents">,
): NormalizedDailyInsight | null {
  const date = optionalString(row.date_start);
  const entityId = entityIdFor(level, row, accountId);
  if (!date || !isDateInRange(date, range) || (row.date_stop !== undefined && row.date_stop !== date) || !entityId) return null;

  const spendMinorUnits = toOptionalMinorUnits(row.spend, currencyCode);
  const impressions = toOptionalInt(row.impressions);
  const reach = toOptionalInt(row.reach);
  const clicks = toOptionalInt(row.clicks);
  const linkClicks = toOptionalInt(row.inline_link_clicks);
  const diagnostic = client.diagnoseResultEvents(row);
  const leads = diagnostic.needsConfiguration || diagnostic.value === null
    ? null
    : Math.max(0, Math.round(diagnostic.value));
  const cpcMinorUnits = metricOrDerived(toOptionalMinorUnits(row.cpc, currencyCode), spendMinorUnits, clicks);
  const cpmMinorUnits = metricOrDerived(toOptionalMinorUnits(row.cpm, currencyCode), spendMinorUnits, impressions, 1_000);
  const ctrLink = linkClicks !== null && impressions !== null && impressions > 0
    ? linkClicks / impressions
    : toOptionalFloat(row.ctr);
  const frequency = toOptionalFloat(row.frequency)
    ?? (impressions !== null && reach !== null && reach > 0 ? impressions / reach : null);

  return {
    date,
    level,
    entityId,
    attributionKey,
    currencyCode,
    spendMinorUnits,
    impressions,
    reach,
    clicks,
    linkClicks,
    leads,
    cplMinorUnits: spendMinorUnits !== null && leads !== null && leads > 0
      ? Math.round(spendMinorUnits / leads)
      : null,
    cpcMinorUnits,
    cpmMinorUnits,
    ctrLink,
    frequency,
    resultActionType: diagnostic.primaryActionType ?? null,
    rawActions: json(row.actions, "null"),
    raw: json({ ...row, resultEventDiagnostic: diagnostic }),
  };
}

function normalizeInsights(
  accountId: string,
  currencyCode: string | null,
  attributionKey: string,
  range: SyncRange,
  insights: Partial<Record<MetaInsightLevel, MetaInsightRow[]>>,
  client: Pick<SyncClient, "diagnoseResultEvents">,
  campaignId?: string,
): { rows: NormalizedDailyInsight[]; skipped: number; missingLeadRows: number; candidateActionTypes: string[] } {
  const byKey = new Map<string, NormalizedDailyInsight>();
  let skipped = 0;
  let missingLeadRows = 0;
  const candidates = new Set<string>();

  for (const level of INSIGHT_LEVELS) {
    for (const raw of insights[level] ?? []) {
      if (campaignId && level !== "account" && raw.campaign_id !== campaignId) {
        skipped += 1;
        continue;
      }
      const diagnostic = client.diagnoseResultEvents(raw);
      if (diagnostic.needsConfiguration || diagnostic.value === null) {
        missingLeadRows += 1;
        diagnostic.candidateActionTypes.forEach((actionType) => candidates.add(actionType));
      }
      const row = normalizeInsight(raw, level, accountId, currencyCode, attributionKey, range, client);
      if (!row) {
        skipped += 1;
        continue;
      }
      byKey.set(`${row.date}:${row.level}:${row.entityId}:${row.attributionKey}`, row);
    }
  }

  return {
    rows: Array.from(byKey.values()),
    skipped,
    missingLeadRows,
    candidateActionTypes: Array.from(candidates).sort(),
  };
}

function warningFor(input: {
  skipped: number;
  missingLeadRows: number;
  candidateActionTypes: string[];
  timeZoneWarning?: string | null;
}): string | null {
  const warnings: string[] = [];
  if (input.timeZoneWarning) warnings.push(input.timeZoneWarning);
  if (input.missingLeadRows > 0) {
    const candidates = input.candidateActionTypes.length > 0
      ? ` Candidate action types: ${input.candidateActionTypes.join(", ")}.`
      : " No configured lead/result action was returned by Meta.";
    warnings.push(`${input.missingLeadRows} insight row(s) have unavailable lead results; leads remain missing, not zero.${candidates}`);
  }
  if (input.skipped > 0) warnings.push(`${input.skipped} malformed insight row(s) were skipped.`);
  return warnings.length > 0 ? warnings.join(" ") : null;
}

async function acquireRun(
  db: PrismaClient,
  input: {
    accountId: string;
    campaignId: string | null;
    attributionKey: string;
    trigger: SyncTrigger;
    now: Date;
    leaseSeconds: number;
  },
) {
  const lockExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
  const lockOwner = crypto.randomUUID();
  try {
    return await db.$transaction(async (tx) => {
      const active = await tx.syncRun.findFirst({
        where: {
          lockKey: input.accountId,
          status: "RUNNING",
          lockExpiresAt: { gt: input.now },
        },
        orderBy: { startedAt: "desc" },
      });
      if (active) throw new SyncAlreadyRunningError();

      const expired = await tx.syncRun.findFirst({
        where: {
          lockKey: input.accountId,
          status: "RUNNING",
          lockExpiresAt: { lte: input.now },
        },
        orderBy: { startedAt: "asc" },
      });
      if (expired) {
        await tx.syncRun.update({
          where: { id: expired.id },
          data: {
            status: "FAILED",
            finishedAt: input.now,
            error: "Sync lease expired before completion; reclaimed safely by a later run.",
            lockKey: null,
            lockOwner: null,
            lockExpiresAt: null,
          },
        });
      }

      return tx.syncRun.create({
        data: {
          accountId: input.accountId,
          campaignId: input.campaignId,
          trigger: input.trigger,
          status: "RUNNING",
          attributionKey: input.attributionKey,
          startedAt: input.now,
          lockKey: input.accountId,
          lockOwner,
          lockExpiresAt,
        },
      });
    });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError || isUniqueConstraintError(error)) {
      throw new SyncAlreadyRunningError();
    }
    throw error;
  }
}

async function markFailed(
  db: PrismaClient,
  runId: string,
  lockOwner: string | null | undefined,
  now: Date,
  error: unknown,
  traceId?: string,
  diagnostics?: string,
): Promise<void> {
  try {
    await db.syncRun.updateMany({
      where: { id: runId, lockOwner: lockOwner ?? undefined },
      data: {
        status: "FAILED",
        finishedAt: now,
        error: safeErrorMessage(error),
        traceId: traceId ?? null,
        apiDiagnostics: diagnostics ?? null,
        lockKey: null,
        lockOwner: null,
        lockExpiresAt: null,
      },
    });
  } catch (updateError) {
    console.error("Unable to mark Meta sync as failed:", safeErrorMessage(updateError));
  }
}

async function discover(
  client: SyncClient,
  account: MetaAccount,
  campaignId?: string,
): Promise<EntityDiscovery> {
  const [campaigns, adSets, ads, creatives] = await Promise.all([
    client.listCampaigns(),
    client.listAdSets(campaignId),
    client.listAds(campaignId),
    client.listCreatives(),
  ]);
  const selectedCampaigns = campaignId
    ? campaigns.filter((campaign) => campaign.id === campaignId)
    : campaigns;
  const selectedAdSets = campaignId
    ? adSets.filter((adSet) => adSet.campaign_id === campaignId)
    : adSets;
  const selectedAds = campaignId
    ? ads.filter((ad) => ad.campaign_id === campaignId)
    : ads;
  const selectedCreativeIds = new Set(selectedAds.map((ad) => ad.creative_id).filter((id): id is string => Boolean(id)));
  const selectedCreatives = campaignId
    ? creatives.filter((creative) => selectedCreativeIds.has(creative.id))
    : creatives;
  return {
    account,
    campaigns: selectedCampaigns,
    adSets: selectedAdSets,
    ads: selectedAds,
    creatives: selectedCreatives,
  };
}

function startLeaseHeartbeat(
  db: PrismaClient,
  runId: string,
  lockOwner: string,
  leaseSeconds: number,
): { stop: () => Promise<void> } {
  const intervalMs = Math.max(1_000, Math.min(30_000, Math.floor(leaseSeconds * 1_000 / 3)));
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  async function renew(): Promise<void> {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    inFlight = (async () => {
      try {
        const now = new Date();
        const result = await db.syncRun.updateMany({
          where: { id: runId, status: "RUNNING", lockOwner },
          data: { lockExpiresAt: new Date(now.getTime() + leaseSeconds * 1_000) },
        });
        if (result.count !== 1) console.error("Meta sync lease renewal was rejected");
      } catch (error) {
        console.error("Meta sync lease renewal failed:", safeErrorMessage(error));
      }
    })().finally(() => {
      inFlight = null;
    });
    await inFlight;
  }

  const timer = setInterval(() => { void renew(); }, intervalMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (inFlight) await inFlight;
    },
  };
}

function insightRange(range: SyncRange): MetaInsightDateRange {
  return { since: range.since, until: range.until };
}

export async function syncMeta(options: SyncOptions = {}): Promise<SyncResult> {
  const { prisma: defaultDb } = await import("@/lib/db");
  const db = options.db ?? defaultDb;
  const client = options.client ?? createMetaClient();
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? "manual";
  const accountId = canonicalAccountId(client.getAccountId());
  const configuredCampaign = configuredCampaignId();
  const runCampaignId = configuredCampaign ?? null;
  const syncScopeKey = runCampaignId ?? "account";
  const attributionKey = client.getAttributionKey();
  const leaseSeconds = options.leaseSeconds ?? positiveInteger(process.env.META_SYNC_LEASE_SECONDS, 900);
  const run = await acquireRun(db, {
    accountId,
    campaignId: runCampaignId,
    attributionKey,
    trigger,
    now,
    leaseSeconds,
  });
  // Deterministic tests inject a clock and do not need a live timer. In
  // production the heartbeat starts before any provider work and remains
  // active through the database transaction so an overlapping invocation
  // cannot reclaim a slow run.
  const heartbeat = !options.clock && run.lockOwner
    ? startLeaseHeartbeat(db, run.id, run.lockOwner, leaseSeconds)
    : null;

  try {
    const previousSuccess = await db.syncRun.findFirst({
      where: { accountId, campaignId: runCampaignId, status: "SUCCEEDED", attributionKey },
      orderBy: { finishedAt: "desc" },
    });
    const account = await client.getAccount();
    if (!account.id || canonicalAccountId(account.id) !== accountId) {
      throw new Error("Meta account response did not match the configured account");
    }
    const accountTimeZone = account.timezone_name || "UTC";
    const validAccountTimeZone = isValidTimeZone(accountTimeZone);
    const timeZone = validAccountTimeZone ? accountTimeZone : "UTC";
    const range = chooseSyncRange({
      timeZone,
      now,
      hasSuccessfulSync: Boolean(previousSuccess),
      initialBackfillDays: options.initialBackfillDays ?? positiveInteger(process.env.META_INITIAL_BACKFILL_DAYS, 90),
      recentRefreshDays: options.recentRefreshDays ?? positiveInteger(process.env.META_RECENT_REFRESH_DAYS, 7),
    });
    const requestRange = insightRange(range);

    await db.syncRun.update({
      where: { id: run.id },
      data: {
        accountName: optionalString(account.name),
        currencyCode: optionalString(account.currency),
        timezoneName: timeZone,
        apiVersion: client.getGraphVersion(),
        requestedSince: range.since,
        requestedUntil: range.until,
        initialBackfill: range.initialBackfill,
      },
    });

    // Metadata discovery is kept inside the same guarded flow as Insights.
    // Starting an unobserved promise here would risk an unhandled rejection if
    // an Insights request failed before the metadata promise was awaited.
    const discovery = await discover(client, account, configuredCampaign);
    const insightEntries: Array<readonly [MetaInsightLevel, MetaInsightRow[]]> = [];
    for (const level of INSIGHT_LEVELS) {
      // Insights are intentionally paced by level. Meta documents that many
      // simultaneous Insights queries are more likely to hit throttling.
      insightEntries.push([level, await client.getDailyInsights(level, requestRange)]);
    }
    const insightRows = Object.fromEntries(insightEntries) as Partial<Record<MetaInsightLevel, MetaInsightRow[]>>;
    const normalized = normalizeInsights(
      accountId,
      optionalString(account.currency),
      attributionKey,
      range,
      insightRows,
      client,
      configuredCampaign,
    );
    const warning = warningFor({
      ...normalized,
      timeZoneWarning: validAccountTimeZone
        ? null
        : `Meta returned an invalid account timezone (${accountTimeZone}); UTC was used for date boundaries.`,
    });
    const rowsFetched = discovery.campaigns.length
      + discovery.adSets.length
      + discovery.ads.length
      + discovery.creatives.length
      + INSIGHT_LEVELS.reduce((total, level) => total + (insightRows[level]?.length ?? 0), 0);
    const rowsWritten = discovery.campaigns.length
      + discovery.adSets.length
      + discovery.ads.length
      + discovery.creatives.length
      + normalized.rows.length;

    const completedAt = options.clock?.() ?? new Date();
    await db.$transaction(async (tx) => {
      for (const campaign of discovery.campaigns) {
        const campaignHasProviderFields = hasProviderFields(campaign);
        const campaignMetadataIsCurrent = hasCompleteProviderMetadata(campaign, CURRENT_METADATA_FIELDS.campaign);
        await tx.campaign.upsert({
          where: { metaId: campaign.id },
          create: {
            metaId: campaign.id,
            name: campaign.name || campaign.id,
            objective: optionalString(campaign.objective),
            configuredStatus: optionalString(campaign.status),
            effectiveStatus: optionalString(campaign.effective_status),
            dailyBudgetMinor: toOptionalInt(campaign.daily_budget),
            lifetimeBudgetMinor: toOptionalInt(campaign.lifetime_budget),
            startDate: optionalString(campaign.start_time),
            stopDate: optionalString(campaign.stop_time),
            providerUpdatedAt: optionalDateTime(campaign.updated_time) ?? null,
            lastSeenSyncRunId: campaignMetadataIsCurrent ? run.id : null,
            raw: json(campaign),
          },
          update: {
            ...(campaignHasProviderFields ? { raw: json(campaign) } : {}),
            ...(hasProviderField(campaign, "name") ? { name: optionalString(campaign.name) ?? campaign.id } : {}),
            ...(hasProviderField(campaign, "objective") ? { objective: optionalString(campaign.objective) } : {}),
            ...(hasProviderField(campaign, "status") ? { configuredStatus: optionalString(campaign.status) } : {}),
            ...(hasProviderField(campaign, "effective_status") ? { effectiveStatus: optionalString(campaign.effective_status) } : {}),
            ...(hasProviderField(campaign, "daily_budget") ? { dailyBudgetMinor: toOptionalInt(campaign.daily_budget) } : {}),
            ...(hasProviderField(campaign, "lifetime_budget") ? { lifetimeBudgetMinor: toOptionalInt(campaign.lifetime_budget) } : {}),
            ...(hasProviderField(campaign, "start_time") ? { startDate: optionalString(campaign.start_time) } : {}),
            ...(hasProviderField(campaign, "stop_time") ? { stopDate: optionalString(campaign.stop_time) } : {}),
            ...(hasProviderField(campaign, "updated_time") ? { providerUpdatedAt: optionalDateTime(campaign.updated_time) ?? null } : {}),
            ...(campaignMetadataIsCurrent ? { lastSeenSyncRunId: run.id } : {}),
          },
        });
      }
      for (const adSet of discovery.adSets) {
        const adSetHasProviderFields = hasProviderFields(adSet);
        const adSetMetadataIsCurrent = hasCompleteProviderMetadata(adSet, CURRENT_METADATA_FIELDS.adSet);
        await tx.adSet.upsert({
          where: { metaId: adSet.id },
          create: {
            metaId: adSet.id,
            campaignMetaId: optionalString(adSet.campaign_id),
            name: adSet.name || adSet.id,
            configuredStatus: optionalString(adSet.status),
            effectiveStatus: optionalString(adSet.effective_status),
            optimisationGoal: optionalString(adSet.optimization_goal),
            billingEvent: optionalString(adSet.billing_event),
            // Meta returns budget fields already in the account currency's
            // smallest unit, unlike spend/cost metrics which are decimal
            // currency strings.
            dailyBudgetMinor: toOptionalInt(adSet.daily_budget),
            lifetimeBudgetMinor: toOptionalInt(adSet.lifetime_budget),
            startDate: optionalString(adSet.start_time),
            endDate: optionalString(adSet.end_time),
            learningStage: learningStage(adSet.learning_stage_info),
            learningStageInfo: json(adSet.learning_stage_info),
            providerUpdatedAt: optionalDateTime(adSet.updated_time) ?? null,
            lastSeenSyncRunId: adSetMetadataIsCurrent ? run.id : null,
            raw: json(adSet),
          },
          update: {
            ...(adSetHasProviderFields ? { raw: json(adSet) } : {}),
            ...(hasProviderField(adSet, "campaign_id") ? { campaignMetaId: optionalString(adSet.campaign_id) } : {}),
            ...(hasProviderField(adSet, "name") ? { name: optionalString(adSet.name) ?? adSet.id } : {}),
            ...(hasProviderField(adSet, "status") ? { configuredStatus: optionalString(adSet.status) } : {}),
            ...(hasProviderField(adSet, "effective_status") ? { effectiveStatus: optionalString(adSet.effective_status) } : {}),
            ...(hasProviderField(adSet, "optimization_goal") ? { optimisationGoal: optionalString(adSet.optimization_goal) } : {}),
            ...(hasProviderField(adSet, "billing_event") ? { billingEvent: optionalString(adSet.billing_event) } : {}),
            ...(hasProviderField(adSet, "daily_budget") ? { dailyBudgetMinor: toOptionalInt(adSet.daily_budget) } : {}),
            ...(hasProviderField(adSet, "lifetime_budget") ? { lifetimeBudgetMinor: toOptionalInt(adSet.lifetime_budget) } : {}),
            ...(hasProviderField(adSet, "start_time") ? { startDate: optionalString(adSet.start_time) } : {}),
            ...(hasProviderField(adSet, "end_time") ? { endDate: optionalString(adSet.end_time) } : {}),
            ...(hasProviderField(adSet, "learning_stage_info") ? {
              learningStage: learningStage(adSet.learning_stage_info),
              learningStageInfo: json(adSet.learning_stage_info),
            } : {}),
            ...(hasProviderField(adSet, "updated_time") ? { providerUpdatedAt: optionalDateTime(adSet.updated_time) ?? null } : {}),
            ...(adSetMetadataIsCurrent ? { lastSeenSyncRunId: run.id } : {}),
          },
        });
      }
      for (const ad of discovery.ads) {
        const adHasProviderFields = hasProviderFields(ad);
        const adMetadataIsCurrent = hasCompleteProviderMetadata(ad, CURRENT_METADATA_FIELDS.ad);
        await tx.ad.upsert({
          where: { metaId: ad.id },
          create: {
            metaId: ad.id,
            campaignMetaId: optionalString(ad.campaign_id),
            adSetMetaId: optionalString(ad.adset_id),
            name: ad.name || ad.id,
            configuredStatus: optionalString(ad.status),
            effectiveStatus: optionalString(ad.effective_status),
            creativeMetaId: optionalString(ad.creative_id),
            providerUpdatedAt: optionalDateTime(ad.updated_time) ?? null,
            lastSeenSyncRunId: adMetadataIsCurrent ? run.id : null,
            raw: json(ad),
          },
          update: {
            ...(adHasProviderFields ? { raw: json(ad) } : {}),
            ...(hasProviderField(ad, "campaign_id") ? { campaignMetaId: optionalString(ad.campaign_id) } : {}),
            ...(hasProviderField(ad, "adset_id") ? { adSetMetaId: optionalString(ad.adset_id) } : {}),
            ...(hasProviderField(ad, "name") ? { name: optionalString(ad.name) ?? ad.id } : {}),
            ...(hasProviderField(ad, "status") ? { configuredStatus: optionalString(ad.status) } : {}),
            ...(hasProviderField(ad, "effective_status") ? { effectiveStatus: optionalString(ad.effective_status) } : {}),
            ...(hasProviderField(ad, "creative_id") ? { creativeMetaId: optionalString(ad.creative_id) } : {}),
            ...(hasProviderField(ad, "updated_time") ? { providerUpdatedAt: optionalDateTime(ad.updated_time) ?? null } : {}),
            ...(adMetadataIsCurrent ? { lastSeenSyncRunId: run.id } : {}),
          },
        });
      }
      for (const creative of discovery.creatives) {
        const creativeHasProviderFields = hasProviderFields(creative);
        const creativeMetadataIsCurrent = hasCompleteProviderMetadata(creative, CURRENT_METADATA_FIELDS.creative);
        const destinationUrl = hasProviderField(creative, "object_url") || hasProviderField(creative, "link_url")
          ? optionalString(creative.object_url) ?? optionalString(creative.link_url)
          : undefined;
        const hasFormatFields = [
          "video_id",
          "image_hash",
          "image_url",
          "thumbnail_url",
          "asset_feed_spec",
        ].some((field) => hasProviderField(creative, field));
        await tx.creative.upsert({
          where: { metaId: creative.id },
          create: {
            metaId: creative.id,
            name: optionalString(creative.name),
            title: optionalString(creative.title),
            body: optionalString(creative.body),
            callToActionType: optionalString(creative.call_to_action_type),
            thumbnailUrl: optionalString(creative.thumbnail_url),
            imageHash: optionalString(creative.image_hash),
            imageUrl: optionalString(creative.image_url),
            videoId: optionalString(creative.video_id),
            objectId: optionalString(creative.object_id),
            destinationUrl: destinationUrl ?? null,
            urlTags: optionalString(creative.url_tags),
            format: creativeFormat(creative),
            providerUpdatedAt: optionalDateTime(creative.updated_time) ?? null,
            lastSeenSyncRunId: creativeMetadataIsCurrent ? run.id : null,
            raw: json(creative.raw ?? creative),
          },
          update: {
            ...(creativeHasProviderFields ? { raw: json(creative.raw ?? creative) } : {}),
            ...(hasProviderField(creative, "name") ? { name: optionalString(creative.name) } : {}),
            ...(hasProviderField(creative, "title") ? { title: optionalString(creative.title) } : {}),
            ...(hasProviderField(creative, "body") ? { body: optionalString(creative.body) } : {}),
            ...(hasProviderField(creative, "call_to_action_type") ? { callToActionType: optionalString(creative.call_to_action_type) } : {}),
            ...(hasProviderField(creative, "thumbnail_url") ? { thumbnailUrl: optionalString(creative.thumbnail_url) } : {}),
            ...(hasProviderField(creative, "image_hash") ? { imageHash: optionalString(creative.image_hash) } : {}),
            ...(hasProviderField(creative, "image_url") ? { imageUrl: optionalString(creative.image_url) } : {}),
            ...(hasProviderField(creative, "video_id") ? { videoId: optionalString(creative.video_id) } : {}),
            ...(hasProviderField(creative, "object_id") ? { objectId: optionalString(creative.object_id) } : {}),
            ...(destinationUrl !== undefined ? { destinationUrl } : {}),
            ...(hasProviderField(creative, "url_tags") ? { urlTags: optionalString(creative.url_tags) } : {}),
            ...(hasFormatFields ? { format: creativeFormat(creative) } : {}),
            ...(hasProviderField(creative, "updated_time") ? { providerUpdatedAt: optionalDateTime(creative.updated_time) ?? null } : {}),
            ...(creativeMetadataIsCurrent ? { lastSeenSyncRunId: run.id } : {}),
          },
        });
      }
      for (const insight of normalized.rows) {
        await tx.dailyInsight.upsert({
          where: {
            date_level_entityId_attributionKey_scopeKey: {
              date: insight.date,
              level: insight.level,
              entityId: insight.entityId,
              attributionKey: insight.attributionKey,
              scopeKey: syncScopeKey,
            },
          },
          create: {
            ...insight,
            scopeKey: syncScopeKey,
            syncRunId: run.id,
          },
          update: {
            // A successful response is the source of truth for this date. Clear
            // omitted fields rather than presenting a previous value as fresh.
            currencyCode: insight.currencyCode,
            spendMinorUnits: insight.spendMinorUnits,
            impressions: insight.impressions,
            reach: insight.reach,
            clicks: insight.clicks,
            linkClicks: insight.linkClicks,
            leads: insight.leads,
            cplMinorUnits: insight.cplMinorUnits,
            cpcMinorUnits: insight.cpcMinorUnits,
            cpmMinorUnits: insight.cpmMinorUnits,
            ctrLink: insight.ctrLink,
            frequency: insight.frequency,
            resultActionType: insight.resultActionType,
            rawActions: insight.rawActions,
            raw: insight.raw,
            observedAt: now,
            syncRunId: run.id,
          },
        });
      }
      const committed = await tx.syncRun.updateMany({
        where: {
          id: run.id,
          status: "RUNNING",
          lockKey: accountId,
          lockOwner: run.lockOwner,
          lockExpiresAt: { gt: completedAt },
        },
        data: {
          accountId,
          accountName: optionalString(discovery.account.name),
          currencyCode: optionalString(discovery.account.currency),
          timezoneName: timeZone,
          apiVersion: client.getGraphVersion(),
          attributionKey,
          requestedSince: range.since,
          requestedUntil: range.until,
          initialBackfill: range.initialBackfill,
          status: "SUCCEEDED",
          finishedAt: completedAt,
          rowsFetched,
          rowsWritten,
          warning,
          error: null,
          traceId: client.getDiagnostics().traceId ?? null,
          apiDiagnostics: json(client.getDiagnostics()),
          lockKey: null,
          lockOwner: null,
          lockExpiresAt: null,
        },
      });
      if (committed.count !== 1) throw new SyncLeaseLostError();
    }, { maxWait: 5_000, timeout: SYNC_TRANSACTION_TIMEOUT_MS });

    let finalWarning = warning;
    try {
      // Recommendations are derived only after the successful read-model
      // commit. This keeps provider ingestion and deterministic analysis
      // separate while making a retry idempotent through the fingerprint.
      const state = await buildDashboardState({ db, now: completedAt, recommendationMode: "derived" });
      if (warning == null && state.meta.metadataStaleCount === 0) {
        await persistRecommendationLifecycle(db, {
          accountId,
          campaignId: runCampaignId,
          attributionKey,
          syncRunId: run.id,
          recommendations: state.recommendations,
          now: completedAt,
        });
      }
    } catch (recommendationError) {
      finalWarning = [warning, "Recommendation lifecycle persistence failed; stored metrics remain available."]
        .filter(Boolean)
        .join(" ");
      console.error("Unable to persist Meta recommendations:", safeErrorMessage(recommendationError));
    }
    if (finalWarning !== warning) {
      await db.syncRun.update({ where: { id: run.id }, data: { warning: finalWarning } });
    }
    await heartbeat?.stop();

    return {
      runId: run.id,
      status: "SUCCEEDED",
      initialBackfill: range.initialBackfill,
      since: range.since,
      until: range.until,
      rowsFetched,
      rowsWritten,
      warning: finalWarning,
    };
  } catch (error) {
    await heartbeat?.stop();
    const finishedAt = options.clock?.() ?? new Date();
    const diagnostics = client.getDiagnostics();
    await markFailed(
      db,
      run.id,
      run.lockOwner,
      finishedAt,
      error,
      diagnostics.traceId,
      json(diagnostics),
    );
    throw error;
  }
}

export function describeResultEvent(diagnostic: MetaResultEventDiagnostic): string | null {
  if (!diagnostic.needsConfiguration && diagnostic.value !== null) return null;
  return diagnostic.candidateActionTypes.length > 0
    ? `Lead/result event unavailable. Candidates: ${diagnostic.candidateActionTypes.join(", ")}.`
    : "Lead/result event unavailable; configure META_PRIMARY_RESULT_ACTION_TYPE.";
}
