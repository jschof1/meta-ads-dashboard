import type { PrismaClient } from "@prisma/client";
import {
  createMetaClient,
  toOptionalCents,
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
import { chooseSyncRange, isValidTimeZone, type SyncRange } from "@/lib/periods";

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

function json(value: unknown, fallback = "{}"): string {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? fallback : encoded;
  } catch {
    return fallback;
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
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
  return secrets.reduce((message, secret) => message.replaceAll(secret, "[REDACTED]"), source).slice(0, 2_000);
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
      return row.account_id || accountId;
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
  client: Pick<SyncClient, "diagnoseResultEvents">,
): NormalizedDailyInsight | null {
  const date = optionalString(row.date_start);
  const entityId = entityIdFor(level, row, accountId);
  if (!date || !entityId) return null;

  const spendMinorUnits = toOptionalCents(row.spend);
  const impressions = toOptionalInt(row.impressions);
  const reach = toOptionalInt(row.reach);
  const clicks = toOptionalInt(row.clicks);
  const linkClicks = toOptionalInt(row.inline_link_clicks);
  const diagnostic = client.diagnoseResultEvents(row);
  const leads = diagnostic.needsConfiguration || diagnostic.value === null
    ? null
    : Math.max(0, Math.round(diagnostic.value));
  const cpcMinorUnits = metricOrDerived(toOptionalCents(row.cpc), spendMinorUnits, clicks);
  const cpmMinorUnits = metricOrDerived(toOptionalCents(row.cpm), spendMinorUnits, impressions, 1_000);
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
  insights: Partial<Record<MetaInsightLevel, MetaInsightRow[]>>,
  client: Pick<SyncClient, "diagnoseResultEvents">,
): { rows: NormalizedDailyInsight[]; skipped: number; missingLeadRows: number; candidateActionTypes: string[] } {
  const byKey = new Map<string, NormalizedDailyInsight>();
  let skipped = 0;
  let missingLeadRows = 0;
  const candidates = new Set<string>();

  for (const level of INSIGHT_LEVELS) {
    for (const raw of insights[level] ?? []) {
      const diagnostic = client.diagnoseResultEvents(raw);
      if (diagnostic.needsConfiguration || diagnostic.value === null) {
        missingLeadRows += 1;
        diagnostic.candidateActionTypes.forEach((actionType) => candidates.add(actionType));
      }
      const row = normalizeInsight(raw, level, accountId, currencyCode, attributionKey, client);
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
): Promise<EntityDiscovery> {
  const [campaigns, adSets, ads, creatives] = await Promise.all([
    client.listCampaigns(),
    client.listAdSets(),
    client.listAds(),
    client.listCreatives(),
  ]);
  return { account, campaigns, adSets, ads, creatives };
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
  const attributionKey = client.getAttributionKey();
  const leaseSeconds = options.leaseSeconds ?? positiveInteger(process.env.META_SYNC_LEASE_SECONDS, 900);
  const run = await acquireRun(db, {
    accountId,
    attributionKey,
    trigger,
    now,
    leaseSeconds,
  });

  try {
    const previousSuccess = await db.syncRun.findFirst({
      where: { accountId, status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
    });
    const account = await client.getAccount();
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

    const discoveryPromise = discover(client, account);
    const insightEntries: Array<readonly [MetaInsightLevel, MetaInsightRow[]]> = [];
    for (const level of INSIGHT_LEVELS) {
      // Insights are intentionally paced by level. Meta documents that many
      // simultaneous Insights queries are more likely to hit throttling.
      insightEntries.push([level, await client.getDailyInsights(level, requestRange)]);
    }
    const discovery = await discoveryPromise;
    const insightRows = Object.fromEntries(insightEntries) as Partial<Record<MetaInsightLevel, MetaInsightRow[]>>;
    const normalized = normalizeInsights(
      accountId,
      optionalString(account.currency),
      attributionKey,
      insightRows,
      client,
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

    await db.$transaction(async (tx) => {
      for (const campaign of discovery.campaigns) {
        await tx.campaign.upsert({
          where: { metaId: campaign.id },
          create: {
            metaId: campaign.id,
            name: campaign.name || campaign.id,
            objective: optionalString(campaign.objective),
            configuredStatus: optionalString(campaign.status),
            effectiveStatus: optionalString(campaign.effective_status),
            startDate: optionalString(campaign.start_time),
            stopDate: optionalString(campaign.stop_time),
            raw: json(campaign),
          },
          update: {
            name: campaign.name || campaign.id,
            objective: optionalString(campaign.objective),
            configuredStatus: optionalString(campaign.status),
            effectiveStatus: optionalString(campaign.effective_status),
            startDate: optionalString(campaign.start_time),
            stopDate: optionalString(campaign.stop_time),
            raw: json(campaign),
          },
        });
      }
      for (const adSet of discovery.adSets) {
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
            raw: json(adSet),
          },
          update: {
            campaignMetaId: optionalString(adSet.campaign_id),
            name: adSet.name || adSet.id,
            configuredStatus: optionalString(adSet.status),
            effectiveStatus: optionalString(adSet.effective_status),
            optimisationGoal: optionalString(adSet.optimization_goal),
            billingEvent: optionalString(adSet.billing_event),
            dailyBudgetMinor: toOptionalInt(adSet.daily_budget),
            lifetimeBudgetMinor: toOptionalInt(adSet.lifetime_budget),
            startDate: optionalString(adSet.start_time),
            endDate: optionalString(adSet.end_time),
            learningStage: learningStage(adSet.learning_stage_info),
            learningStageInfo: json(adSet.learning_stage_info),
            raw: json(adSet),
          },
        });
      }
      for (const ad of discovery.ads) {
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
            raw: json(ad),
          },
          update: {
            campaignMetaId: optionalString(ad.campaign_id),
            adSetMetaId: optionalString(ad.adset_id),
            name: ad.name || ad.id,
            configuredStatus: optionalString(ad.status),
            effectiveStatus: optionalString(ad.effective_status),
            creativeMetaId: optionalString(ad.creative_id),
            raw: json(ad),
          },
        });
      }
      for (const creative of discovery.creatives) {
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
            destinationUrl: optionalString(creative.object_url) ?? optionalString(creative.link_url),
            urlTags: optionalString(creative.url_tags),
            format: creativeFormat(creative),
            raw: json(creative.raw ?? creative),
          },
          update: {
            name: optionalString(creative.name),
            title: optionalString(creative.title),
            body: optionalString(creative.body),
            callToActionType: optionalString(creative.call_to_action_type),
            thumbnailUrl: optionalString(creative.thumbnail_url),
            imageHash: optionalString(creative.image_hash),
            imageUrl: optionalString(creative.image_url),
            videoId: optionalString(creative.video_id),
            objectId: optionalString(creative.object_id),
            destinationUrl: optionalString(creative.object_url) ?? optionalString(creative.link_url),
            urlTags: optionalString(creative.url_tags),
            format: creativeFormat(creative),
            raw: json(creative.raw ?? creative),
          },
        });
      }
      for (const insight of normalized.rows) {
        await tx.dailyInsight.upsert({
          where: {
            date_level_entityId_attributionKey: {
              date: insight.date,
              level: insight.level,
              entityId: insight.entityId,
              attributionKey: insight.attributionKey,
            },
          },
          create: {
            ...insight,
            syncRunId: run.id,
          },
          update: {
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
          lockExpiresAt: { gt: options.clock?.() ?? new Date() },
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
          finishedAt: now,
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
    });

    return {
      runId: run.id,
      status: "SUCCEEDED",
      initialBackfill: range.initialBackfill,
      since: range.since,
      until: range.until,
      rowsFetched,
      rowsWritten,
      warning,
    };
  } catch (error) {
    const diagnostics = client.getDiagnostics();
    await markFailed(
      db,
      run.id,
      run.lockOwner,
      now,
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
