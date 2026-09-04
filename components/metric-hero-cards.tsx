"use client";

import { ArrowDownRight, ArrowUpRight, Coins, Minus, TrendingUp } from "lucide-react";
import type { DashboardPeriod, DashboardState, EntityEvidence, TrendPoint } from "@/lib/state-types";
import { formatDateLabel, formatMoney } from "@/lib/format";
import { comparisonIsComparable, comparisonLabel, currentBucket, comparisonBucket, periodDefinition } from "@/lib/dashboard-periods";
import { evidenceForBucket, ratioDelta } from "@/lib/dashboard-metrics";
import { UKTL_CONFIG, type MoneyTarget } from "@/lib/targets";

type SeriesPoint = { date: string; value: number | null };
type Band = MoneyTarget;

function Sparkline({ series, color, chartId }: { series: SeriesPoint[]; color: string; chartId: string }) {
  const values = series.filter((point): point is SeriesPoint & { value: number } => point.value != null);
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const spread = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const denominator = Math.max(series.length - 1, 1);
  const points = series
    .map((point, index) => point.value == null ? null : `${(index / denominator) * 100},${36 - ((point.value - min) / spread) * 28}`)
    .filter((point): point is string => point != null)
    .join(" ");
  return (
    <svg className="h-full w-full" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-labelledby={chartId}>
      <title id={chartId}>Daily trend</title>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function targetBand(target: MoneyTarget): Band | null {
  const values = [target.targetMinorUnits, target.acceptableMinorUnits, target.maximumMinorUnits]
    .filter((value): value is number => value != null);
  return values.length === 0 ? null : target;
}

function lowerIsBetterStatus(value: number | null, band: Band | null, evidence: EntityEvidence): "good" | "watch" | "alert" | "unknown" {
  if (value == null || band == null || evidence.status !== "sufficient") return "unknown";
  if (band.targetMinorUnits != null && value <= band.targetMinorUnits) return "good";
  if (band.acceptableMinorUnits != null && value <= band.acceptableMinorUnits) return "watch";
  if (band.maximumMinorUnits != null) return value > band.maximumMinorUnits ? "alert" : "watch";
  return "watch";
}

function targetLabel(target: MoneyTarget, currencyCode: string | null): string {
  if (target.targetMinorUnits != null) return `Target ≤ ${formatMoney(target.targetMinorUnits, currencyCode)}`;
  if (target.acceptableMinorUnits != null) return `Acceptable ≤ ${formatMoney(target.acceptableMinorUnits, currencyCode)}`;
  if (target.maximumMinorUnits != null) return `Maximum ${formatMoney(target.maximumMinorUnits, currencyCode)}`;
  return "Target not set";
}

function trendForPeriod(trend: TrendPoint[], period: DashboardPeriod): TrendPoint[] {
  if (period === "today") return trend.slice(-1);
  if (period === "7d") return trend.slice(-7);
  if (period === "14d") return trend.slice(-14);
  if (period === "mtd") {
    const month = trend.at(-1)?.date.slice(0, 7);
    return month ? trend.filter((point) => point.date.startsWith(month)) : trend;
  }
  return trend;
}

function readingLine(
  metric: "cpl" | "cpm",
  latest: number | null,
  comparison: number | null,
  band: Band | null,
  evidence: EntityEvidence,
  comparisonLabel: string,
): string {
  if (evidence.status !== "sufficient") return evidence.reason;
  if (latest == null) return metric === "cpl" ? "Awaiting stored lead evidence." : "Awaiting stored impression evidence.";
  const delta = ratioDelta(latest, comparison);
  const trendWord = delta == null ? "steady" : delta > 5 ? "climbing" : delta < -5 ? "improving" : "steady";
  if (!band) {
    return comparison == null
      ? `No ${metric.toUpperCase()} target set; collecting a historical baseline.`
      : `No ${metric.toUpperCase()} target set; ${trendWord} versus ${comparisonLabel}.`;
  }
  const status = lowerIsBetterStatus(latest, band, evidence);
  if (metric === "cpl") {
    if (status === "good") return `Inside the configured target, ${trendWord}.`;
    if (status === "watch") return `Inside the configured acceptable range, ${trendWord}.`;
    return "Above the configured maximum; review lead quality and trend.";
  }
  if (status === "good") return `Auction healthy against target, ${trendWord}.`;
  if (status === "watch") return `Auction inside the configured acceptable range, ${trendWord}.`;
  return `Auction expensive, ${trendWord}. Review fresh creative.`;
}

function HeroCard({
  title,
  Icon,
  series,
  headline,
  format,
  band,
  bandLabel,
  reading,
  delta,
  comparisonLabel,
  evidence,
  chartId,
}: {
  title: string;
  Icon: typeof TrendingUp;
  series: SeriesPoint[];
  headline: number | null;
  format: (value: number | null | undefined) => string;
  band: Band | null;
  bandLabel: string;
  reading: string;
  delta: number | null;
  comparisonLabel: string;
  evidence: EntityEvidence;
  chartId: string;
}) {
  const status = lowerIsBetterStatus(headline, band, evidence);
  const targetConfigured = band != null;
  const chartColor = status === "good" ? "#10b981" : status === "alert" ? "#ef4444" : status === "watch" ? "#f59e0b" : "#64748b";
  const DeltaIcon = delta == null ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const deltaColor = delta == null
    ? "text-muted-foreground"
    : delta > 5 ? "text-destructive" : delta < -5 ? "text-emerald-500" : "text-muted-foreground";
  const accent = status === "good" ? "text-emerald-500" : status === "alert" ? "text-destructive" : status === "watch" ? "text-amber-500" : "text-muted-foreground";
  const hasSeriesValue = series.some((point) => point.value != null);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${status === "good" ? "bg-emerald-500/10 text-emerald-500" : status === "alert" ? "bg-destructive/10 text-destructive" : status === "watch" ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className={`text-2xl font-bold tabular-nums ${accent}`}>{format(headline)}</div>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-right text-xs font-medium ${deltaColor}`}>
          <DeltaIcon className="h-3.5 w-3.5" />
          {delta == null ? "—" : `${Math.abs(delta).toFixed(1)}%`}
          <span className="hidden font-normal text-muted-foreground sm:inline">vs {comparisonLabel}</span>
        </div>
      </div>
      <div className="-mx-2 mb-3 h-20">
        {series.length > 0 && hasSeriesValue ? (
          <Sparkline series={series} color={chartColor} chartId={chartId} />
        ) : <div className="flex h-full items-center justify-center rounded-lg bg-muted/30 text-xs text-muted-foreground">No daily evidence in this period.</div>}
      </div>
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{bandLabel}</span>
        <div className="mx-3 h-1 flex-1 overflow-hidden rounded-full bg-muted">
          {targetConfigured && <div className="h-full w-2/5 rounded-full bg-emerald-500/30" />}
        </div>
        <span className={evidence.status === "sufficient" ? "text-emerald-500" : evidence.status === "thin" ? "text-amber-500" : "text-muted-foreground"} title={evidence.reason}>
          {evidence.status === "sufficient" ? "Sufficient" : evidence.status === "thin" ? "Thin" : "Unknown"}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-foreground/80"><span className="mr-1 text-primary">Read:</span>{reading}</p>
    </div>
  );
}

export function MetricHeroCards({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const trend = trendForPeriod(state.trend, period);
  const current = currentBucket(state.scorecard, period);
  const comparison = comparisonBucket(state.scorecard, period);
  const comparableComparison = comparisonIsComparable(period, state.meta.mtdComparisonComparable) ? comparison : null;
  const evidence = evidenceForBucket(current);
  const definition = periodDefinition(period);
  const comparisonText = comparisonLabel(period, state.meta.mtdComparisonComparable);
  const cplBand = targetBand(UKTL_CONFIG.targets.cpl);
  const cpmBand = targetBand(UKTL_CONFIG.targets.cpm);
  const cplSeries = trend.map((point) => ({ date: formatDateLabel(point.date, state.meta.timezoneName), value: point.cplCents }));
  const cpmSeries = trend.map((point) => ({ date: formatDateLabel(point.date, state.meta.timezoneName), value: point.cpmCents != null && point.cpmCents > 0 ? point.cpmCents : null }));
  if (state.trend.length === 0) {
    return <section className="mb-6 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">No trend data yet. Hero metrics populate after the campaign collects daily insights.</section>;
  }
  return (
    <section className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
      <HeroCard
        title={`${definition.label} CPL`}
        Icon={Coins}
        series={cplSeries}
        headline={current.cplCents}
        format={(value) => formatMoney(value, state.meta.currencyCode)}
        band={cplBand}
        bandLabel={targetLabel(UKTL_CONFIG.targets.cpl, state.meta.currencyCode)}
        reading={readingLine("cpl", current.cplCents, comparableComparison?.cplCents ?? null, cplBand, evidence, comparisonText)}
        delta={ratioDelta(current.cplCents, comparableComparison?.cplCents ?? null)}
        comparisonLabel={comparisonText}
        evidence={evidence}
        chartId={`cpl-${period}`}
      />
      <HeroCard
        title={`${definition.label} CPM`}
        Icon={TrendingUp}
        series={cpmSeries}
        headline={current.cpmCents}
        format={(value) => formatMoney(value, state.meta.currencyCode)}
        band={cpmBand}
        bandLabel={targetLabel(UKTL_CONFIG.targets.cpm, state.meta.currencyCode)}
        reading={readingLine("cpm", current.cpmCents, comparableComparison?.cpmCents ?? null, cpmBand, evidence, comparisonText)}
        delta={ratioDelta(current.cpmCents, comparableComparison?.cpmCents ?? null)}
        comparisonLabel={comparisonText}
        evidence={evidence}
        chartId={`cpm-${period}`}
      />
    </section>
  );
}
