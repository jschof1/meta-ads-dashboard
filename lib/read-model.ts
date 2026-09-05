import type {
  Ad,
  AdSet,
  ActionLog,
  Campaign,
  Creative,
  DailyInsight,
  SyncRun,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { dateRangeForPeriod, addCalendarDays, accountLocalDate, isPreviousMtdComparable, type ReportingPeriod } from "@/lib/periods";
import { buildHeatmap, buildPhase, buildTriggers, detectAnomalies, scoreFatigue } from "@/lib/insights";
import { UKTL_CONFIG, classifyAd } from "@/lib/targets";
import { DASHBOARD_PERIODS, periodDefinition } from "@/lib/dashboard-periods";
import { buildSpendStatus } from "@/lib/spend-status";
import { evidenceByPeriod, evidenceForBucket } from "@/lib/dashboard-metrics";
import { analyseRecommendations, isValidComparisonWindow, metricsFromBucket } from "@/lib/recommendations";
import { readActiveRecommendationViews } from "@/lib/recommendation-store";
import type {
  ActionLogEntry,
  AdRow,
  AdSetRow,
  Bucket,
  CampaignRow,
  DashboardState,
  DataWarning,
  PeriodBuckets,
  PeriodDataWarnings,
  TrendPoint,
} from "@/lib/state-types";
import type { ComparisonWindow, RecommendationCandidate, RecommendationSeriesPoint } from "@/lib/recommendation-types";

const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
const PERIODS: ReportingPeriod[] = [
  "today",
  "yesterday",
  "mtd",
  "previousMtd",
  "7d",
  "previous7d",
  "14d",
  "previous14d",
  "30d",
  "previous30d",
];

function configuredAccountId(): string | undefined {
  const value = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!value) return undefined;
  return value.startsWith("act_") ? value : `act_${value}`;
}

function configuredAttributionKey(): string {
  const windows = process.env.META_ATTRIBUTION_WINDOWS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (windows && windows.length > 0 ? windows : ["7d_click", "1d_view"]).join(",");
}

type StoredInsight = DailyInsight;

function sumNullable(rows: StoredInsight[], key: keyof StoredInsight): number | null {
  if (rows.length === 0 || rows.some((row) => row[key] === null || row[key] === undefined)) return null;
  return rows.reduce((total, row) => total + Number(row[key]), 0);
}

function weightedAverage(rows: StoredInsight[], valueKey: keyof StoredInsight, weightKey: keyof StoredInsight): number | null {
  if (rows.length === 0 || rows.some((row) => row[valueKey] == null || row[weightKey] == null)) return null;
  const totalWeight = rows.reduce((total, row) => total + Number(row[weightKey]), 0);
  if (totalWeight <= 0) return null;
  return rows.reduce((total, row) => total + Number(row[valueKey]) * Number(row[weightKey]), 0) / totalWeight;
}

/** Aggregate numerators first, then derive rates from the totals. */
export function aggregateInsights(rows: StoredInsight[]): Bucket {
  const spendCents = sumNullable(rows, "spendMinorUnits");
  const impressions = sumNullable(rows, "impressions");
  const linkClicks = sumNullable(rows, "linkClicks");
  const clicks = sumNullable(rows, "clicks");
  const leads = sumNullable(rows, "leads");
  return {
    spendCents,
    impressions,
    linkClicks,
    leads,
    cplCents: spendCents != null && leads != null && leads > 0
      ? Math.round(spendCents / leads)
      : null,
    cpcCents: spendCents != null && clicks != null && clicks > 0
      ? Math.round(spendCents / clicks)
      : null,
    ctrLink: linkClicks != null && impressions != null && impressions > 0
      ? linkClicks / impressions
      : null,
    cpmCents: spendCents != null && impressions != null && impressions > 0
      ? Math.round((spendCents / impressions) * 1_000)
      : null,
    // Daily reach cannot be summed into de-duplicated cross-day reach. Report
    // the clearly-labelled weighted daily diagnostic instead of pretending it
    // is a unique-audience frequency.
    frequency: weightedAverage(rows, "frequency", "impressions"),
  };
}

function daysBetween(start: string | null, end: string): number | null {
  if (!start) return null;
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(0, Math.floor((endMs - startMs) / 86_400_000));
}

function firstSeen(rows: StoredInsight[]): string | null {
  const dates = rows
    .filter((row) => row.impressions != null && row.impressions > 0)
    .map((row) => row.date)
    .sort();
  return dates[0] ?? null;
}

function trendPoint(date: string, rows: StoredInsight[]): TrendPoint {
  return { date, ...aggregateInsights(rows) };
}

function actionLog(rows: ActionLog[]): ActionLogEntry[] {
  return rows.map((row) => ({
    id: row.id,
    createdAt: new Date(row.createdAt).toISOString(),
    action: row.action,
    targetId: row.targetId,
    reasoning: row.reasoning,
    executor: row.executor,
    result: row.result,
  }));
}

function syncState(
  latestAttempt: SyncRun | null,
  latestSuccess: SyncRun | null,
  lastSuccessfulAgeMs: number | null,
): DashboardState["meta"]["syncState"] {
  if (!latestAttempt) return "never";
  if (latestAttempt.status === "RUNNING") return "running";
  if (latestAttempt.status === "FAILED") return "failed";
  if (!latestSuccess) return "never";
  return lastSuccessfulAgeMs != null && lastSuccessfulAgeMs > STALE_AFTER_MS ? "stale" : "fresh";
}

function dateSinceLaunch(launchDate: string | undefined, timeZone: string, now: Date): number | null {
  if (!launchDate || !/^\d{4}-\d{2}-\d{2}$/.test(launchDate)) return null;
  const today = accountLocalDate(now, timeZone);
  const startMs = Date.parse(`${launchDate}T00:00:00.000Z`);
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(todayMs)) return null;
  return Math.max(0, Math.floor((todayMs - startMs) / 86_400_000));
}

function periodBuckets(rows: StoredInsight[], timeZone: string, now: Date): PeriodBuckets {
  const rowsFor = (period: ReportingPeriod) => {
    const range = dateRangeForPeriod(period, timeZone, now);
    return rows.filter((row) => row.date >= range.since && row.date <= range.until);
  };
  return {
    today: aggregateInsights(rowsFor("today")),
    yesterday: aggregateInsights(rowsFor("yesterday")),
    mtd: aggregateInsights(rowsFor("mtd")),
    previousMtd: aggregateInsights(rowsFor("previousMtd")),
    last7: aggregateInsights(rowsFor("7d")),
    previous7: aggregateInsights(rowsFor("previous7d")),
    last14: aggregateInsights(rowsFor("14d")),
    previous14: aggregateInsights(rowsFor("previous14d")),
    last30: aggregateInsights(rowsFor("30d")),
    previous30: aggregateInsights(rowsFor("previous30d")),
  };
}

function markOmittedInsightRowsUnknown(rows: StoredInsight[], latestSuccess: SyncRun | null): StoredInsight[] {
  const since = latestSuccess?.requestedSince;
  const until = latestSuccess?.requestedUntil;
  if (!latestSuccess || !since || !until) return rows;
  return rows.map((row) => {
    const insideLatestRequest = row.date >= since && row.date <= until;
    if (!insideLatestRequest || row.syncRunId === latestSuccess.id) return row;
    return {
      ...row,
      spendMinorUnits: null,
      impressions: null,
      reach: null,
      clicks: null,
      linkClicks: null,
      leads: null,
      cplMinorUnits: null,
      cpcMinorUnits: null,
      cpmMinorUnits: null,
      ctrLink: null,
      frequency: null,
      resultActionType: null,
      rawActions: "[]",
    };
  });
}

function insightRowsAreCurrent(rows: StoredInsight[], latestSuccess: SyncRun | null): boolean {
  const since = latestSuccess?.requestedSince;
  const until = latestSuccess?.requestedUntil;
  if (!latestSuccess || !since || !until) return true;
  return rows
    .filter((row) => row.date >= since && row.date <= until)
    .every((row) => row.syncRunId === latestSuccess.id);
}

function currentPeriodEvidence(periods: PeriodBuckets) {
  return evidenceByPeriod({
    today: periods.today,
    "7d": periods.last7,
    "14d": periods.last14,
    "30d": periods.last30,
    mtd: periods.mtd,
  });
}

function groupByEntity(rows: StoredInsight[], level: string): Map<string, StoredInsight[]> {
  const grouped = new Map<string, StoredInsight[]>();
  for (const row of rows) {
    if (row.level !== level) continue;
    const current = grouped.get(row.entityId) ?? [];
    current.push(row);
    grouped.set(row.entityId, current);
  }
  return grouped;
}

function addMetadataOnlyEntities<T>(grouped: Map<string, StoredInsight[]>, metadata: T[], getId: (item: T) => string): void {
  for (const item of metadata) {
    const id = getId(item);
    if (!grouped.has(id)) grouped.set(id, []);
  }
}

function latestProviderChange(...values: (Date | null | undefined)[]): string | null {
  const dates = values
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());
  return dates[0]?.toISOString() ?? null;
}

function classifyStoredAd(bucket: Bucket) {
  const evidence = evidenceForBucket(bucket);
  if (evidence.status !== "sufficient") {
    return { verdict: "too_early" as const, reason: evidence.reason };
  }
  return classifyAd({
    spendCents: bucket.spendCents,
    leads: bucket.leads,
    cplCents: bucket.cplCents,
    ctrLink: bucket.ctrLink,
  });
}

function adRows(
  rows: StoredInsight[],
  ads: Ad[],
  creatives: Creative[],
  today: string,
  timeZone: string,
  now: Date,
  metadataRunId: string,
  latestSuccess: SyncRun | null,
): AdRow[] {
  const metadata = new Map(ads.map((ad) => [ad.metaId, ad]));
  const creativeMetadata = new Map(creatives.map((creative) => [creative.metaId, creative]));
  const grouped = groupByEntity(rows, "ad");
  addMetadataOnlyEntities(grouped, ads, (ad) => ad.metaId);

  return Array.from(grouped.entries()).map(([adId, adInsightRows]) => {
    const periods = periodBuckets(adInsightRows, timeZone, now);
    const bucket = periods.last30;
    const previousBucket = periods.previous30;
    const ad = metadata.get(adId);
    const creative = ad?.creativeMetaId ? creativeMetadata.get(ad.creativeMetaId) : undefined;
    const evidence = currentPeriodEvidence(periods);
    const firstSeenDate = firstSeen(adInsightRows);
    const fatigue = scoreFatigue({
      frequency: bucket.frequency,
      ctrLink: bucket.ctrLink,
      cplCents: bucket.cplCents,
      impressions: bucket.impressions,
      leads: bucket.leads,
      daysActive: daysBetween(firstSeenDate, today),
      spendCents: bucket.spendCents,
      previousFrequency: previousBucket.frequency,
      previousCtrLink: previousBucket.ctrLink,
      previousCplCents: previousBucket.cplCents,
      previousImpressions: previousBucket.impressions,
      previousLeads: previousBucket.leads,
      previousSpendCents: previousBucket.spendCents,
    });
    const verdict = classifyStoredAd(bucket);
    return {
      adId,
      adName: ad?.name || adId,
      status: ad?.effectiveStatus || ad?.configuredStatus || "UNKNOWN",
      thumbnailUrl: creative?.thumbnailUrl ?? null,
      imageUrl: creative?.imageUrl ?? null,
      videoId: creative?.videoId ?? null,
      creativeId: ad?.creativeMetaId ?? null,
      format: creative?.format ?? null,
      title: creative?.title ?? null,
      body: creative?.body ?? null,
      callToAction: creative?.callToActionType ?? null,
      destinationUrl: creative?.destinationUrl ?? null,
      lastChangeAt: latestProviderChange(ad?.providerUpdatedAt, creative?.providerUpdatedAt),
      campaignId: ad?.campaignMetaId ?? null,
      adSetId: ad?.adSetMetaId ?? null,
      isCurrent: ad?.lastSeenSyncRunId === metadataRunId
        && insightRowsAreCurrent(adInsightRows, latestSuccess)
        && (creative == null || creative.lastSeenSyncRunId === metadataRunId),
      periods,
      evidence,
      evidenceStatus: evidence["30d"].status,
      spendCents: bucket.spendCents,
      impressions: bucket.impressions,
      linkClicks: bucket.linkClicks,
      ctrLink: bucket.ctrLink,
      leads: bucket.leads,
      cplCents: bucket.cplCents,
      frequency: bucket.frequency,
      verdict: verdict.verdict,
      verdictReason: verdict.reason,
      firstSeenDate,
      daysActive: daysBetween(firstSeenDate, today),
      fatigueScore: fatigue.score,
      fatigueReason: fatigue.reason,
    };
  }).sort((left, right) => {
    if (left.cplCents == null && right.cplCents == null) return (right.spendCents ?? -1) - (left.spendCents ?? -1);
    if (left.cplCents == null) return 1;
    if (right.cplCents == null) return -1;
    return left.cplCents - right.cplCents;
  });
}

function campaignRows(rows: StoredInsight[], campaigns: Campaign[], timeZone: string, now: Date, metadataRunId: string, latestSuccess: SyncRun | null): CampaignRow[] {
  const metadata = new Map(campaigns.map((campaign) => [campaign.metaId, campaign]));
  const grouped = groupByEntity(rows, "campaign");
  addMetadataOnlyEntities(grouped, campaigns, (campaign) => campaign.metaId);
  return Array.from(grouped.entries()).map(([campaignId, insightRows]) => {
    const campaign = metadata.get(campaignId);
    const periods = periodBuckets(insightRows, timeZone, now);
    const evidence = currentPeriodEvidence(periods);
    return {
      campaignId,
      campaignName: campaign?.name || campaignId,
      objective: campaign?.objective ?? null,
      status: campaign?.effectiveStatus || campaign?.configuredStatus || "UNKNOWN",
      isCurrent: campaign?.lastSeenSyncRunId === metadataRunId && insightRowsAreCurrent(insightRows, latestSuccess),
      dailyBudgetMinor: campaign?.dailyBudgetMinor ?? null,
      lifetimeBudgetMinor: campaign?.lifetimeBudgetMinor ?? null,
      startDate: campaign?.startDate ?? null,
      stopDate: campaign?.stopDate ?? null,
      periods,
      evidence,
      evidenceStatus: evidence["30d"].status,
    };
  }).sort((left, right) => left.campaignName.localeCompare(right.campaignName));
}

function adSetRows(rows: StoredInsight[], adSets: AdSet[], timeZone: string, now: Date, metadataRunId: string, latestSuccess: SyncRun | null): AdSetRow[] {
  const metadata = new Map(adSets.map((adSet) => [adSet.metaId, adSet]));
  const grouped = groupByEntity(rows, "adset");
  addMetadataOnlyEntities(grouped, adSets, (adSet) => adSet.metaId);
  return Array.from(grouped.entries()).map(([adSetId, insightRows]) => {
    const adSet = metadata.get(adSetId);
    const periods = periodBuckets(insightRows, timeZone, now);
    const evidence = currentPeriodEvidence(periods);
    return {
      adSetId,
      campaignId: adSet?.campaignMetaId ?? null,
      adSetName: adSet?.name || adSetId,
      status: adSet?.effectiveStatus || adSet?.configuredStatus || "UNKNOWN",
      isCurrent: adSet?.lastSeenSyncRunId === metadataRunId && insightRowsAreCurrent(insightRows, latestSuccess),
      learningStage: adSet?.learningStage ?? null,
      dailyBudgetMinor: adSet?.dailyBudgetMinor ?? null,
      lifetimeBudgetMinor: adSet?.lifetimeBudgetMinor ?? null,
      startDate: adSet?.startDate ?? null,
      endDate: adSet?.endDate ?? null,
      periods,
      evidence,
      evidenceStatus: evidence["30d"].status,
    };
  }).sort((left, right) => left.adSetName.localeCompare(right.adSetName));
}

function entityInsightRows(rows: StoredInsight[], level: string, entityId: string): StoredInsight[] {
  return rows.filter((row) => row.level === level && row.entityId === entityId);
}

function recommendationSeries(rows: StoredInsight[]): RecommendationSeriesPoint[] {
  const byDate = new Map<string, StoredInsight[]>();
  for (const row of rows) {
    const current = byDate.get(row.date) ?? [];
    current.push(row);
    byDate.set(row.date, current);
  }
  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, dateRows]) => ({ date, metrics: metricsFromBucket(aggregateInsights(dateRows)) }));
}

function configuredRecommendationComparisonDays(): ComparisonWindow {
  const raw = process.env.META_RECOMMENDATION_COMPARISON_DAYS?.trim();
  const value = raw && /^\d+$/.test(raw) ? Number(raw) : 7;
  return Number.isInteger(value) && isValidComparisonWindow(value) ? value : 7;
}

function recommendationRanges(comparisonDays: ComparisonWindow, timeZone: string, now: Date) {
  const today = accountLocalDate(now, timeZone);
  return {
    current: { since: addCalendarDays(today, -(comparisonDays - 1)), until: today },
    previous: { since: addCalendarDays(today, -((comparisonDays * 2) - 1)), until: addCalendarDays(today, -comparisonDays) },
    cumulative: dateRangeForPeriod("30d", timeZone, now),
  };
}

function rowsInRange(rows: StoredInsight[], range: { since: string; until: string }): StoredInsight[] {
  return rows.filter((row) => row.date >= range.since && row.date <= range.until);
}

function buildRecommendationCandidates(input: {
  accountId: string | null;
  accountName: string | null;
  accountRows: StoredInsight[];
  campaigns: CampaignRow[];
  adSets: AdSetRow[];
    ads: AdRow[];
    readableRows: StoredInsight[];
    daysSinceLaunch: number | null;
    today: string;
    timeZone: string;
    now: Date;
  }): RecommendationCandidate[] {
  if (!input.accountId) return [];

  const candidates: RecommendationCandidate[] = [];
  const learningByAdSetId = new Map(input.adSets.map((adSet) => [adSet.adSetId, adSet.learningStage]));
  const add = (result: RecommendationCandidate[]) => candidates.push(...result);
  const comparisonDays = configuredRecommendationComparisonDays();
  const analyseEntity = (entity: {
    target: { type: "account" | "campaign" | "adset" | "ad"; id: string; name: string };
    rows: StoredInsight[];
    status: string | null;
    learningState: string | null;
    daysActive: number | null;
    budgetCents?: number | null;
  }) => {
    const ranges = recommendationRanges(comparisonDays, input.timeZone, input.now);
    const currentRows = rowsInRange(entity.rows, ranges.current);
    const previousRows = rowsInRange(entity.rows, ranges.previous);
    const cumulativeRows = rowsInRange(entity.rows, ranges.cumulative);
    add(analyseRecommendations({
      config: UKTL_CONFIG,
      target: entity.target,
      comparisonDays,
      ranges,
      current: metricsFromBucket(aggregateInsights(currentRows)),
      previous: previousRows.length > 0 ? metricsFromBucket(aggregateInsights(previousRows)) : null,
      cumulative: cumulativeRows.length > 0 ? metricsFromBucket(aggregateInsights(cumulativeRows)) : null,
      status: entity.status,
      learningState: entity.learningState,
      series: recommendationSeries(entity.rows),
      sampleSize: currentRows.length,
      daysActive: entity.daysActive,
      budgetCents: entity.budgetCents,
    }).recommendations);
  };

  analyseEntity({
    target: { type: "account", id: input.accountId, name: cleanName(input.accountName, "UK Trade Leads") },
    rows: input.accountRows,
    status: null,
    learningState: null,
    daysActive: input.daysSinceLaunch,
    budgetCents: UKTL_CONFIG.targets.monthlyBudgetMinorUnits,
  });

  for (const campaign of input.campaigns) {
    const rows = entityInsightRows(input.readableRows, "campaign", campaign.campaignId);
    analyseEntity({
      target: { type: "campaign", id: campaign.campaignId, name: campaign.campaignName },
      rows,
      status: campaign.status,
      learningState: null,
      daysActive: daysBetween(firstSeen(rows), input.today),
      budgetCents: campaign.dailyBudgetMinor == null ? null : campaign.dailyBudgetMinor * 30,
    });
  }

  for (const adSet of input.adSets) {
    const rows = entityInsightRows(input.readableRows, "adset", adSet.adSetId);
    analyseEntity({
      target: { type: "adset", id: adSet.adSetId, name: adSet.adSetName },
      rows,
      status: adSet.status,
      learningState: adSet.learningStage,
      daysActive: daysBetween(firstSeen(rows), input.today),
      budgetCents: adSet.dailyBudgetMinor == null ? null : adSet.dailyBudgetMinor * 30,
    });
  }

  for (const ad of input.ads) {
    const rows = entityInsightRows(input.readableRows, "ad", ad.adId);
    analyseEntity({
      target: { type: "ad", id: ad.adId, name: ad.adName },
      rows,
      status: ad.status,
      learningState: ad.adSetId ? learningByAdSetId.get(ad.adSetId) ?? null : null,
      daysActive: ad.daysActive,
    });
  }

  return candidates;
}

function cleanName(value: string | null, fallback: string): string {
  const normalised = value?.trim().replace(/\s+/g, " ");
  return (normalised || fallback).slice(0, 240);
}

type DashboardStateOptions = {
  db?: PrismaClient;
  now?: Date;
  /** Sync uses derived candidates before lifecycle persistence; readers use stored views. */
  recommendationMode?: "persisted" | "derived";
};

type DerivedDashboardState = Omit<DashboardState, "recommendations"> & {
  recommendations: RecommendationCandidate[];
};

export function buildDataWarnings(input: {
  state: DashboardState["meta"]["syncState"];
  current: Bucket;
  comparison: Bucket;
  comparisonComparable?: boolean;
  metadataStaleCount?: number;
}): DataWarning[] {
  const warnings: DataWarning[] = [];
  if (input.comparisonComparable === false) {
    warnings.push({ id: "mtd-shorter-comparison", severity: "info", label: "MTD comparison withheld", detail: "The prior month ended before the current elapsed day, so no directional MTD change is shown." });
  }
  if (input.state === "failed") {
    warnings.push({ id: "sync-failed", severity: "alert", label: "Latest sync failed", detail: "The dashboard is showing the last successful stored data. Resolve the sync failure before treating current performance as fresh." });
  } else if (input.state === "stale") {
    warnings.push({ id: "sync-stale", severity: "warn", label: "Stored data is stale", detail: "The dashboard is showing the last successful sync; refresh data before making a time-sensitive decision." });
  } else if (input.state === "running") {
    warnings.push({ id: "sync-running", severity: "info", label: "Sync in progress", detail: "The dashboard is continuing to show the last successful stored data until this run completes." });
  } else if (input.state === "never") {
    warnings.push({ id: "sync-never", severity: "warn", label: "Awaiting first sync", detail: "No successful Meta sync is stored, so performance values remain unknown." });
  }

  if ((input.metadataStaleCount ?? 0) > 0) {
    warnings.push({
      id: "metadata-not-current",
      severity: "warn",
      label: "Some entity data is not current",
      detail: "One or more stored campaigns, ad sets or ads were not returned by the latest successful sync for the requested window. Historical metrics are retained, but the displayed metrics, status, budget or learning state may be stale.",
    });
  }

  const hasActivity = (input.current.spendCents != null && input.current.spendCents > 0)
    || (input.current.impressions != null && input.current.impressions > 0)
    || (input.current.linkClicks != null && input.current.linkClicks > 0);
  if (hasActivity && input.current.leads == null) {
    warnings.push({ id: "missing-lead-event", severity: "alert", label: "Lead event missing", detail: "Meta returned activity without a usable configured lead result. Leads and CPL stay unknown; check the result event configuration." });
  }
  if (hasActivity && input.current.leads === 0 && input.current.spendCents != null && input.current.spendCents > 0) {
    warnings.push({ id: "spend-without-results", severity: "warn", label: "Spend without results", detail: "The selected period contains spend but Meta reports zero leads. Check the landing path and result event before changing ads." });
  }
  if (input.comparison.leads != null && input.comparison.leads > 0 && input.current.leads === 0 && hasActivity) {
    warnings.push({ id: "disappearing-events", severity: "alert", label: "Lead results disappeared", detail: "The comparison period had lead results but the selected period has none while spend continues. Check tracking and recent delivery changes." });
  }
  return warnings;
}

export function buildDataWarningsByPeriod(input: {
  state: DashboardState["meta"]["syncState"];
  buckets: PeriodBuckets;
  mtdComparisonComparable?: boolean;
  metadataStaleCount?: number;
}): PeriodDataWarnings {
  const warnings = {} as PeriodDataWarnings;
  for (const period of DASHBOARD_PERIODS) {
    const definition = periodDefinition(period);
    const comparisonComparable = period !== "mtd" || input.mtdComparisonComparable !== false;
    warnings[period] = buildDataWarnings({
      state: input.state,
      current: input.buckets[definition.current],
      comparison: comparisonComparable ? input.buckets[definition.comparison] : aggregateInsights([]),
      comparisonComparable,
      metadataStaleCount: input.metadataStaleCount,
    });
  }
  return warnings;
}

export function buildDashboardState(options: DashboardStateOptions & { recommendationMode: "derived" }): Promise<DerivedDashboardState>;
export function buildDashboardState(options?: DashboardStateOptions): Promise<DashboardState>;
export async function buildDashboardState(options: DashboardStateOptions = {}): Promise<DashboardState | DerivedDashboardState> {
  const db = options.db ?? defaultPrisma;
  const now = options.now ?? new Date();
  const accountId = configuredAccountId();
  const campaignId = process.env.META_CAMPAIGN_ID?.trim() || null;
  const attributionKey = configuredAttributionKey();
  const runScope = { attributionKey, campaignId, ...(accountId ? { accountId } : {}) };
  const [latestAttempt, latestSuccess, logs] = await Promise.all([
    accountId
      ? db.syncRun.findFirst({ where: runScope, orderBy: { startedAt: "desc" } })
      : Promise.resolve(null),
    accountId
      ? db.syncRun.findFirst({ where: { ...runScope, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } })
      : Promise.resolve(null),
    db.actionLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const timeZone = latestSuccess?.timezoneName || "UTC";
  const mtdComparisonComparable = isPreviousMtdComparable(now, timeZone);
  const todayRange = dateRangeForPeriod("today", timeZone, now);
  const requiredRanges = [dateRangeForPeriod("previous30d", timeZone, now), dateRangeForPeriod("previousMtd", timeZone, now)];
  const oldestSince = requiredRanges.map((range) => range.since).sort()[0];
  const successfulRunIds = latestSuccess
    ? (await db.syncRun.findMany({
      where: { accountId: latestSuccess.accountId, campaignId: latestSuccess.campaignId, attributionKey, status: "SUCCEEDED" },
      select: { id: true },
    })).map((run) => run.id)
    : [];
  const storedRows = latestSuccess && successfulRunIds.length > 0
    ? await db.dailyInsight.findMany({
      where: {
        date: { gte: oldestSince, lte: todayRange.until },
        attributionKey,
        syncRunId: { in: successfulRunIds },
      },
      orderBy: [{ date: "asc" }, { level: "asc" }, { entityId: "asc" }],
    })
    : [];
  const readableRows = markOmittedInsightRowsUnknown(storedRows, latestSuccess);
  const currentAdIds = [...new Set(readableRows.filter((row) => row.level === "ad").map((row) => row.entityId))];
  const currentCampaignIds = [...new Set(readableRows.filter((row) => row.level === "campaign").map((row) => row.entityId))];
  const currentAdSetIds = [...new Set(readableRows.filter((row) => row.level === "adset").map((row) => row.entityId))];
  const metadataRunId = latestSuccess?.id ?? "__no_successful_sync__";
  const [campaigns, adSets, ads] = await Promise.all([
    db.campaign.findMany({ where: { OR: [{ lastSeenSyncRunId: metadataRunId }, { metaId: { in: currentCampaignIds } }] }, orderBy: { name: "asc" } }),
    db.adSet.findMany({ where: { OR: [{ lastSeenSyncRunId: metadataRunId }, { metaId: { in: currentAdSetIds } }] }, orderBy: { name: "asc" } }),
    db.ad.findMany({ where: { OR: [{ lastSeenSyncRunId: metadataRunId }, { metaId: { in: currentAdIds } }] }, orderBy: { name: "asc" } }),
  ]);
  const currentCreativeIds = [...new Set(ads.map((ad) => ad.creativeMetaId).filter((id): id is string => id != null))];
  const creatives = await db.creative.findMany({ where: { metaId: { in: currentCreativeIds } }, orderBy: { name: "asc" } });
  const storedAccountId = latestSuccess?.accountId ?? null;
  const accountRows = readableRows.filter((row) => row.level === "account" && row.entityId === storedAccountId);
  const buckets = periodBuckets(accountRows, timeZone, now);
  const trendRange = dateRangeForPeriod("30d", timeZone, now);
  const trend: TrendPoint[] = [];
  for (let date = trendRange.since; date <= trendRange.until; date = addCalendarDays(date, 1)) {
    trend.push(trendPoint(date, accountRows.filter((row) => row.date === date)));
  }
  const dsl = dateSinceLaunch(process.env.META_CAMPAIGN_LAUNCH_DATE, timeZone, now);
  const latestSuccessAt = latestSuccess?.finishedAt ? new Date(latestSuccess.finishedAt).toISOString() : null;
  const latestAttemptAt = latestAttempt?.finishedAt
    ? new Date(latestAttempt.finishedAt).toISOString()
    : latestAttempt?.startedAt
      ? new Date(latestAttempt.startedAt).toISOString()
      : null;
  const lastSuccessfulAgeMs = latestSuccess?.finishedAt ? Math.max(0, now.getTime() - new Date(latestSuccess.finishedAt).getTime()) : null;
  const last7 = buckets.last7;
  const phase = buildPhase({
    daysSinceLaunch: dsl,
    spendCentsMTD: buckets.mtd.spendCents,
    monthlyBudgetCents: UKTL_CONFIG.targets.monthlyBudgetMinorUnits,
    leadsThisWeek: last7.leads,
  });
  const adsState = adRows(readableRows, ads, creatives, todayRange.until, timeZone, now, metadataRunId, latestSuccess);
  const campaignState = campaignRows(readableRows, campaigns, timeZone, now, metadataRunId, latestSuccess);
  const adSetState = adSetRows(readableRows, adSets, timeZone, now, metadataRunId, latestSuccess);
  const currentState = syncState(latestAttempt, latestSuccess, lastSuccessfulAgeMs);
  const metadataStaleCount = [...campaignState, ...adSetState, ...adsState].filter((row) => !row.isCurrent).length;
  const localToday = accountLocalDate(now, timeZone);
  const spendStatus = buildSpendStatus({
    spendCents: buckets.mtd.spendCents,
    budgetCents: UKTL_CONFIG.targets.monthlyBudgetMinorUnits,
    localDate: localToday,
  });
  const dataWarnings = buildDataWarningsByPeriod({
    state: currentState,
    buckets,
    mtdComparisonComparable,
    metadataStaleCount,
  });
  const derivedRecommendations = options.recommendationMode === "derived"
    ? buildRecommendationCandidates({
      accountId: storedAccountId,
      accountName: latestSuccess?.accountName ?? null,
      accountRows,
      campaigns: campaignState,
      adSets: adSetState,
      ads: adsState,
      readableRows,
      daysSinceLaunch: dsl,
      today: todayRange.until,
      timeZone,
      now,
    })
    : [];
  const recommendations = options.recommendationMode === "derived"
    ? derivedRecommendations
    : storedAccountId
      ? await readActiveRecommendationViews(db, {
        accountId: storedAccountId,
        campaignId,
        attributionKey,
      })
      : [];
  return {
    meta: {
      adAccountId: storedAccountId,
      accountName: latestSuccess?.accountName ?? null,
      campaignId,
      launchDate: process.env.META_CAMPAIGN_LAUNCH_DATE || null,
      daysSinceLaunch: dsl,
      currencyCode: latestSuccess?.currencyCode ?? null,
      timezoneName: latestSuccess?.timezoneName ?? null,
      lastSyncAt: latestSuccessAt,
      lastSyncAgeMs: lastSuccessfulAgeMs,
      lastSuccessfulSyncAt: latestSuccessAt,
      lastAttemptAt: latestAttemptAt,
      lastAttemptStatus: latestAttempt?.status ?? null,
      lastSyncError: latestAttempt?.status === "FAILED"
        ? "Meta sync failed; see server logs for the redacted provider diagnostic."
        : null,
      mtdComparisonComparable,
      metadataStaleCount,
      syncState: currentState,
    },
    scorecard: {
      ...buckets,
      leadsThisWeek: last7.leads,
      learningProgress: last7.leads == null || UKTL_CONFIG.targets.learningLeadsPerWeek == null
        ? null
        : Math.min(1, last7.leads / UKTL_CONFIG.targets.learningLeadsPerWeek),
      learningLeadsTarget: UKTL_CONFIG.targets.learningLeadsPerWeek,
      budget: {
        dailyCents: UKTL_CONFIG.targets.dailyBudgetMinorUnits,
        monthlyCents: UKTL_CONFIG.targets.monthlyBudgetMinorUnits,
      },
      spendStatus,
    },
    trend,
    heatmap: buildHeatmap(trend),
    ads: adsState,
    campaigns: campaignState,
    adSets: adSetState,
    dataWarnings,
    funnel: {
      metaPixelImpressions: buckets.last30.impressions,
      metaPixelLinkClicks: buckets.last30.linkClicks,
      leads: buckets.last30.leads,
      contacted: null,
      qualified: null,
      callsBooked: null,
      callsAttended: null,
      wonCustomers: null,
      lostCustomers: null,
      metaPixelLeads: buckets.last30.leads,
      testEmailsExcluded: 0,
      duplicatesCollapsed: 0,
      crmConfigured: false,
    },
    anomalies: detectAnomalies(trend),
    actionLog: actionLog(logs),
    phase,
    triggers: buildTriggers({
      cplCentsLast7: last7.cplCents,
      currencyCode: latestSuccess?.currencyCode ?? null,
      frequencyLast7: last7.frequency,
      leadsThisWeek: last7.leads,
      daysSinceLaunch: dsl,
      ads: adsState.map((ad) => ({ fatigueScore: ad.fatigueScore, adName: ad.adName, evidenceStatus: ad.evidence["30d"].status })),
    }),
    recommendations,
    targets: UKTL_CONFIG,
  } as DashboardState | DerivedDashboardState;
}

export function periodRanges(timeZone: string, now = new Date()): Record<ReportingPeriod, { since: string; until: string }> {
  return Object.fromEntries(PERIODS.map((period) => [period, dateRangeForPeriod(period, timeZone, now)])) as Record<ReportingPeriod, { since: string; until: string }>;
}

export { STALE_AFTER_MS };
