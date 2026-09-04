import type {
  Ad,
  ActionLog,
  Creative,
  DailyInsight,
  SyncRun,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { dateRangeForPeriod, addCalendarDays, accountLocalDate, type ReportingPeriod } from "@/lib/periods";
import { buildHeatmap, buildPhase, buildTriggers, detectAnomalies, scoreFatigue } from "@/lib/insights";
import { CAMPAIGN_TARGETS, classifyAd } from "@/lib/targets";
import type { ActionLogEntry, AdRow, Bucket, DashboardState, TrendPoint } from "@/lib/state-types";

const STALE_AFTER_MS = 26 * 60 * 60 * 1_000;
const PERIODS: ReportingPeriod[] = [
  "today",
  "yesterday",
  "mtd",
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

function aggregate(rows: StoredInsight[]): Bucket {
  const spendCents = sumNullable(rows, "spendMinorUnits");
  const impressions = sumNullable(rows, "impressions");
  const linkClicks = sumNullable(rows, "linkClicks");
  const registrations = sumNullable(rows, "leads");
  return {
    spendCents,
    impressions,
    linkClicks,
    registrations,
    cprCents: spendCents != null && registrations != null && registrations > 0
      ? Math.round(spendCents / registrations)
      : null,
    ctrLink: linkClicks != null && impressions != null && impressions > 0
      ? linkClicks / impressions
      : null,
    cpmCents: spendCents != null && impressions != null && impressions > 0
      ? Math.round((spendCents / impressions) * 1_000)
      : null,
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
  return { date, ...aggregate(rows) };
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

function adRows(
  rows: StoredInsight[],
  ads: Ad[],
  creatives: Creative[],
  today: string,
): AdRow[] {
  const metadata = new Map(ads.map((ad) => [ad.metaId, ad]));
  const creativeMetadata = new Map(creatives.map((creative) => [creative.metaId, creative]));
  const grouped = new Map<string, StoredInsight[]>();
  for (const row of rows) {
    const current = grouped.get(row.entityId) ?? [];
    current.push(row);
    grouped.set(row.entityId, current);
  }

  return Array.from(grouped.entries()).map(([adId, adInsightRows]) => {
    const bucket = aggregate(adInsightRows);
    const ad = metadata.get(adId);
    const creative = ad?.creativeMetaId ? creativeMetadata.get(ad.creativeMetaId) : undefined;
    const firstSeenDate = firstSeen(adInsightRows);
    const fatigue = scoreFatigue({
      frequency: bucket.frequency,
      ctrLink: bucket.ctrLink,
      cprCents: bucket.cprCents,
      daysActive: daysBetween(firstSeenDate, today),
      spendCents: bucket.spendCents,
    });
    const verdict = classifyAd({
      spendCents: bucket.spendCents,
      registrations: bucket.registrations,
      cprCents: bucket.cprCents,
      ctrLink: bucket.ctrLink,
    });
    return {
      adId,
      adName: ad?.name || adId,
      status: ad?.effectiveStatus || ad?.configuredStatus || "UNKNOWN",
      thumbnailUrl: creative?.thumbnailUrl ?? null,
      spendCents: bucket.spendCents,
      impressions: bucket.impressions,
      linkClicks: bucket.linkClicks,
      ctrLink: bucket.ctrLink,
      registrations: bucket.registrations,
      cprCents: bucket.cprCents,
      frequency: bucket.frequency,
      verdict: verdict.verdict,
      verdictReason: verdict.reason,
      firstSeenDate,
      daysActive: daysBetween(firstSeenDate, today),
      fatigueScore: fatigue.score,
      fatigueReason: fatigue.reason,
    };
  }).sort((left, right) => {
    if (left.cprCents == null && right.cprCents == null) return (right.spendCents ?? -1) - (left.spendCents ?? -1);
    if (left.cprCents == null) return 1;
    if (right.cprCents == null) return -1;
    return left.cprCents - right.cprCents;
  });
}

export async function buildDashboardState(options: { db?: PrismaClient; now?: Date } = {}): Promise<DashboardState> {
  const db = options.db ?? defaultPrisma;
  const now = options.now ?? new Date();
  const accountId = configuredAccountId();
  const attributionKey = configuredAttributionKey();
  const runScope = { attributionKey, ...(accountId ? { accountId } : {}) };
  const [latestAttempt, latestSuccess, ads, creatives, logs] = await Promise.all([
    db.syncRun.findFirst({ where: runScope, orderBy: { startedAt: "desc" } }),
    db.syncRun.findFirst({ where: { ...runScope, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    db.ad.findMany({ orderBy: { name: "asc" } }),
    db.creative.findMany({ orderBy: { name: "asc" } }),
    db.actionLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const timeZone = latestSuccess?.timezoneName || "UTC";
  const todayRange = dateRangeForPeriod("today", timeZone, now);
  const oldestRange = dateRangeForPeriod("previous30d", timeZone, now);
  const storedRows = latestSuccess
    ? await db.dailyInsight.findMany({
      where: {
        date: { gte: oldestRange.since, lte: todayRange.until },
        attributionKey,
      },
      orderBy: [{ date: "asc" }, { level: "asc" }, { entityId: "asc" }],
    })
    : [];
  const storedAccountId = latestSuccess?.accountId ?? null;
  const accountRows = storedRows.filter((row) => row.level === "account" && row.entityId === storedAccountId);
  const adInsightRows = storedRows.filter((row) => row.level === "ad" && row.date >= dateRangeForPeriod("30d", timeZone, now).since);
  const rowsFor = (period: ReportingPeriod) => {
    const range = dateRangeForPeriod(period, timeZone, now);
    return accountRows.filter((row) => row.date >= range.since && row.date <= range.until);
  };
  const buckets = Object.fromEntries(PERIODS.map((period) => [period, aggregate(rowsFor(period))])) as Record<ReportingPeriod, Bucket>;
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
  const last7 = buckets["7d"];
  const mtd = buckets.mtd;
  const phase = buildPhase({
    daysSinceLaunch: dsl,
    spendCentsMTD: mtd.spendCents,
    monthlyBudgetCents: CAMPAIGN_TARGETS.monthly_budget_cents,
    registrationsThisWeek: last7.registrations,
  });
  const adsState = adRows(adInsightRows, ads, creatives, todayRange.until);
  return {
    meta: {
      adAccountId: storedAccountId,
      campaignId: process.env.META_CAMPAIGN_ID ?? null,
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
      syncState: syncState(latestAttempt, latestSuccess, lastSuccessfulAgeMs),
    },
    scorecard: {
      today: buckets.today,
      yesterday: buckets.yesterday,
      mtd,
      last7,
      previous7: buckets.previous7d,
      last14: buckets["14d"],
      previous14: buckets.previous14d,
      last30: buckets["30d"],
      previous30: buckets.previous30d,
      eventsThisWeek: last7.registrations,
      learningProgress: last7.registrations == null
        ? null
        : Math.min(1, last7.registrations / CAMPAIGN_TARGETS.learning_phase.events_per_week_for_exit),
      learningEventsTarget: CAMPAIGN_TARGETS.learning_phase.events_per_week_for_exit,
      budget: {
        dailyCents: CAMPAIGN_TARGETS.daily_budget_cents,
        monthlyCents: CAMPAIGN_TARGETS.monthly_budget_cents,
      },
    },
    trend,
    heatmap: buildHeatmap(trend),
    ads: adsState,
    funnel: {
      metaPixelImpressions: buckets["30d"].impressions,
      metaPixelLinkClicks: buckets["30d"].linkClicks,
      registrations: buckets["30d"].registrations,
      attended: null,
      callsBooked: null,
      enrollments: null,
      metaPixelRegistrations: buckets["30d"].registrations,
      testEmailsExcluded: 0,
      duplicatesCollapsed: 0,
      crmConfigured: false,
    },
    anomalies: detectAnomalies(trend),
    actionLog: actionLog(logs),
    phase,
    triggers: buildTriggers({
      cprCentsLast7: last7.cprCents,
      frequencyLast7: last7.frequency,
      registrationsThisWeek: last7.registrations,
      daysSinceLaunch: dsl,
      ads: adsState.map((ad) => ({ fatigueScore: ad.fatigueScore, adName: ad.adName })),
    }),
    targets: CAMPAIGN_TARGETS,
  };
}

export function periodRanges(timeZone: string, now = new Date()): Record<ReportingPeriod, { since: string; until: string }> {
  return Object.fromEntries(PERIODS.map((period) => [period, dateRangeForPeriod(period, timeZone, now)])) as Record<ReportingPeriod, { since: string; until: string }>;
}

export { STALE_AFTER_MS };
