"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDownRight, ArrowUpRight, Coins, Minus, TrendingUp } from "lucide-react";
import type { DashboardState, TrendPoint } from "@/lib/state-types";
import { formatDateLabel, formatMoney } from "@/lib/format";
import { UKTL_CONFIG, type MoneyTarget } from "@/lib/targets";

type SeriesPoint = { date: string; value: number | null };
type Band = { lo: number; hi: number };

function avg(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value != null && value > 0);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function deltaPct(latest: number | null, baseline: number | null): number | null {
  if (latest == null || baseline == null || baseline === 0) return null;
  return ((latest - baseline) / baseline) * 100;
}

function targetBand(target: MoneyTarget): Band | null {
  const values = [target.targetMinorUnits, target.acceptableMinorUnits, target.maximumMinorUnits]
    .filter((value): value is number => value != null);
  if (values.length === 0) return null;
  const lo = target.targetMinorUnits ?? target.acceptableMinorUnits ?? 0;
  const hi = target.acceptableMinorUnits ?? target.maximumMinorUnits ?? target.targetMinorUnits ?? lo;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function targetLabel(target: MoneyTarget, currencyCode: string | null): string {
  if (target.targetMinorUnits != null) return `Target ≤ ${formatMoney(target.targetMinorUnits, currencyCode)}`;
  if (target.acceptableMinorUnits != null) return `Acceptable ≤ ${formatMoney(target.acceptableMinorUnits, currencyCode)}`;
  if (target.maximumMinorUnits != null) return `Maximum ${formatMoney(target.maximumMinorUnits, currencyCode)}`;
  return "Target not set";
}

function readingLine(
  metric: "cpl" | "cpm",
  latest: number | null,
  baseline: number | null,
  band: Band | null,
): string {
  if (latest == null) return metric === "cpl" ? "Awaiting stored lead evidence." : "Awaiting stored impression evidence.";
  const d = deltaPct(latest, baseline);
  const trendWord = d == null ? "steady" : d > 5 ? "climbing" : d < -5 ? "improving" : "steady";

  if (!band) {
    return baseline == null
      ? `No ${metric.toUpperCase()} target set; collecting a historical baseline.`
      : `No ${metric.toUpperCase()} target set; compared with the previous 7d, ${trendWord}.`;
  }
  const inBand = latest >= band.lo && latest <= band.hi;
  if (metric === "cpl") {
    if (latest < band.lo) return "Below the configured range; compare lead quality before scaling.";
    if (inBand) return `Inside the configured range, ${trendWord}.`;
    return "Above the configured range; review lead quality and trend.";
  }
  if (inBand) return `Auction healthy, ${trendWord}.`;
  if (latest < band.lo) return "Below the configured range; monitor reach and delivery.";
  return `Auction expensive, ${trendWord}. Review fresh creative.`;
}

function HeroCard({
  title,
  Icon,
  series,
  format,
  band,
  bandLabel,
  reading,
  delta,
}: {
  title: string;
  Icon: typeof TrendingUp;
  series: SeriesPoint[];
  format: (value: number | null | undefined) => string;
  band: Band | null;
  bandLabel: string;
  reading: string;
  delta: number | null;
}) {
  const latest = series.length > 0 ? series[series.length - 1].value : null;
  const inBand = band != null && latest != null && latest >= band.lo && latest <= band.hi;
  const targetConfigured = band != null;
  const deltaIcon = delta == null ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
  const DeltaIcon = deltaIcon;
  const deltaColor = delta == null
    ? "text-muted-foreground"
    : delta > 5 ? "text-destructive" : delta < -5 ? "text-emerald-500" : "text-muted-foreground";
  const accent = !targetConfigured ? "text-muted-foreground" : inBand ? "text-emerald-500" : "text-amber-500";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 relative overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${!targetConfigured ? "bg-muted text-muted-foreground" : inBand ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className={`text-2xl font-bold tabular-nums ${accent}`}>{format(latest)}</div>
          </div>
        </div>

        {delta != null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
            <DeltaIcon className="w-3.5 h-3.5" />
            {Math.abs(delta).toFixed(1)}%
            <span className="text-muted-foreground font-normal">vs 7d avg</span>
          </div>
        )}
      </div>

      <div className="h-20 -mx-2 mb-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={!targetConfigured ? "#64748b" : inBand ? "#10b981" : "#f59e0b"} stopOpacity={0.4} />
                <stop offset="100%" stopColor={!targetConfigured ? "#64748b" : inBand ? "#10b981" : "#f59e0b"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip
              contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 11, borderRadius: 8 }}
              formatter={(value: unknown) => format(typeof value === "number" ? value : null)}
              labelFormatter={(label: unknown) => String(label ?? "")}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={!targetConfigured ? "#64748b" : inBand ? "#10b981" : "#f59e0b"}
              strokeWidth={2}
              fill={`url(#grad-${title})`}
              connectNulls
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-between text-[11px] mb-2">
        <span className="text-muted-foreground">{bandLabel}</span>
        <div className="flex-1 mx-3 h-1 rounded-full bg-muted overflow-hidden relative">
          {targetConfigured && <div className="absolute inset-y-0 bg-emerald-500/30" style={{ left: "30%", right: "30%" }} />}
        </div>
      </div>

      <p className="text-xs text-foreground/80 leading-relaxed">
        <span className="text-primary mr-1">Read:</span>
        {reading}
      </p>
    </div>
  );
}

export function MetricHeroCards({ state }: { state: DashboardState }) {
  const trend = state.trend;
  if (trend.length === 0) {
    return (
      <section className="rounded-xl border border-border bg-card p-6 mb-6 text-sm text-muted-foreground">
        No trend data yet. Hero metrics populate after the campaign collects daily insights.
      </section>
    );
  }

  const trendWithMoney = trend.map((point: TrendPoint) => ({
    date: formatDateLabel(point.date, state.meta.timezoneName),
    cpl: point.cplCents,
    cpm: point.cpmCents != null && point.cpmCents > 0 ? point.cpmCents : null,
  }));

  const cplSeries: SeriesPoint[] = trendWithMoney.map((point) => ({ date: point.date, value: point.cpl }));
  const cpmSeries: SeriesPoint[] = trendWithMoney.map((point) => ({ date: point.date, value: point.cpm }));
  const cplLatest = cplSeries[cplSeries.length - 1]?.value ?? null;
  const cpmLatest = cpmSeries[cpmSeries.length - 1]?.value ?? null;
  const cplBaseline = avg(cplSeries.slice(0, -1).map((point) => point.value));
  const cpmBaseline = avg(cpmSeries.slice(0, -1).map((point) => point.value));
  const cplBand = targetBand(UKTL_CONFIG.targets.cpl);
  const cpmBand = targetBand(UKTL_CONFIG.targets.cpm);

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <HeroCard
        title="CPL (Cost per Lead)"
        Icon={Coins}
        series={cplSeries}
        format={(value) => formatMoney(value, state.meta.currencyCode)}
        band={cplBand}
        bandLabel={targetLabel(UKTL_CONFIG.targets.cpl, state.meta.currencyCode)}
        reading={readingLine("cpl", cplLatest, cplBaseline, cplBand)}
        delta={deltaPct(cplLatest, cplBaseline)}
      />
      <HeroCard
        title="CPM (Cost per 1k Impressions)"
        Icon={TrendingUp}
        series={cpmSeries}
        format={(value) => formatMoney(value, state.meta.currencyCode)}
        band={cpmBand}
        bandLabel={targetLabel(UKTL_CONFIG.targets.cpm, state.meta.currencyCode)}
        reading={readingLine("cpm", cpmLatest, cpmBaseline, cpmBand)}
        delta={deltaPct(cpmLatest, cpmBaseline)}
      />
    </section>
  );
}
