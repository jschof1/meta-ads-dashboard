"use client";

import { ChevronDown, Layers3, Target } from "lucide-react";
import type { AdSetRow, CampaignRow, DashboardPeriod, DashboardState } from "@/lib/state-types";
import { currentBucket, periodDefinition } from "@/lib/dashboard-periods";
import { evidenceForBucket } from "@/lib/dashboard-metrics";
import { formatCount, formatMoney, formatPercent, formatStoredDate } from "@/lib/format";

function statusBadge(status: string) {
  const value = status.toUpperCase();
  if (value.includes("ACTIVE")) return "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
  if (value.includes("PAUSED")) return "border-border bg-muted text-muted-foreground";
  return "border-amber-500/20 bg-amber-500/10 text-amber-500";
}

function evidenceLabel(status: "unknown" | "thin" | "sufficient") {
  return status === "sufficient" ? "Evidence sufficient" : status === "thin" ? "Thin sample" : "Evidence unknown";
}

function MetricStrip({ row, currencyCode, period }: { row: CampaignRow | AdSetRow; currencyCode: string | null; period: DashboardPeriod }) {
  const bucket = currentBucket(row.periods, period);
  return (
    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <div className="rounded-lg bg-muted/50 p-2"><div className="text-muted-foreground">{period} spend</div><div className="mt-0.5 font-semibold tabular-nums">{formatMoney(bucket.spendCents, currencyCode)}</div></div>
      <div className="rounded-lg bg-muted/50 p-2"><div className="text-muted-foreground">{period} leads</div><div className="mt-0.5 font-semibold tabular-nums">{formatCount(bucket.leads)}</div></div>
      <div className="rounded-lg bg-muted/50 p-2"><div className="text-muted-foreground">{period} CPL</div><div className="mt-0.5 font-semibold tabular-nums">{formatMoney(bucket.cplCents, currencyCode)}</div></div>
      <div className="rounded-lg bg-muted/50 p-2"><div className="text-muted-foreground">{period} link CTR</div><div className="mt-0.5 font-semibold tabular-nums">{formatPercent(bucket.ctrLink)}</div></div>
    </div>
  );
}

function AdSetCard({ row, currencyCode, period }: { row: AdSetRow; currencyCode: string | null; period: DashboardPeriod }) {
  const bucket = currentBucket(row.periods, period);
  const evidence = row.evidence[period] || evidenceForBucket(bucket);
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <Layers3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0"><p className="truncate text-sm font-medium">{row.adSetName}</p><p className="truncate text-[11px] text-muted-foreground">{row.adSetId}</p></div>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(row.status)}`}>{row.status.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><span className="text-muted-foreground">Learning</span><p className="mt-0.5 font-medium">{row.learningStage || "Unknown"}</p></div>
        <div><span className="text-muted-foreground">Daily budget</span><p className="mt-0.5 font-medium tabular-nums">{formatMoney(row.dailyBudgetMinor, currencyCode)}</p></div>
        <div><span className="text-muted-foreground">Lifetime budget</span><p className="mt-0.5 font-medium tabular-nums">{formatMoney(row.lifetimeBudgetMinor, currencyCode)}</p></div>
        <div><span className="text-muted-foreground">{period} CPL</span><p className="mt-0.5 font-medium tabular-nums">{formatMoney(bucket.cplCents, currencyCode)}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>{period} spend {formatMoney(bucket.spendCents, currencyCode)}</span>
        <span>{period} leads {formatCount(bucket.leads)}</span>
        {!row.isCurrent && <span className="text-amber-500">Not current in latest sync</span>}
        <span className={evidence.status === "sufficient" ? "text-emerald-500" : evidence.status === "thin" ? "text-amber-500" : "text-muted-foreground"} title={evidence.reason}>{evidenceLabel(evidence.status)}</span>
      </div>
    </div>
  );
}

function CampaignCard({ row, adSets, currencyCode, timezoneName, period }: { row: CampaignRow; adSets: AdSetRow[]; currencyCode: string | null; timezoneName: string | null; period: DashboardPeriod }) {
  const bucket = currentBucket(row.periods, period);
  const evidence = row.evidence[period] || evidenceForBucket(bucket);
  const children = adSets.filter((adSet) => adSet.campaignId === row.campaignId);
  return (
    <details className="group rounded-2xl border border-border bg-card" open>
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-start gap-3">
          <Target className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{row.campaignName}</h3><p className="mt-0.5 truncate text-xs text-muted-foreground">{row.campaignId}{row.objective ? ` · ${row.objective}` : ""}</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(row.status)}`}>{row.status.replace(/_/g, " ")}</span>
          {!row.isCurrent && <span className="hidden rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500 sm:inline">Not current in latest sync</span>}
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </div>
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3">
        <MetricStrip row={row} currencyCode={currencyCode} period={period} />
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>Daily budget {formatMoney(row.dailyBudgetMinor, currencyCode)}</span>
          <span>Lifetime budget {formatMoney(row.lifetimeBudgetMinor, currencyCode)}</span>
          {!row.isCurrent && <span className="text-amber-500">Not current in latest sync</span>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{period} spend {formatMoney(bucket.spendCents, currencyCode)}</span>
          <span>{period} leads {formatCount(bucket.leads)}</span>
          <span className={evidence.status === "sufficient" ? "text-emerald-500" : evidence.status === "thin" ? "text-amber-500" : "text-muted-foreground"} title={evidence.reason}>{evidenceLabel(evidence.status)}</span>
          {row.startDate && <span>Starts {formatStoredDate(row.startDate, timezoneName)}</span>}
        </div>
        <div className="mt-4 space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ad sets</h4>
          {children.length > 0 ? children.map((adSet) => <AdSetCard key={adSet.adSetId} row={adSet} currencyCode={currencyCode} period={period} />) : <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">No stored ad-set insight rows are available for this campaign.</p>}
        </div>
      </div>
    </details>
  );
}

export function CampaignDrilldown({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const definition = periodDefinition(period);
  const campaignIds = new Set(state.campaigns.map((campaign) => campaign.campaignId));
  const unmatchedAdSets = state.adSets.filter((adSet) => !adSet.campaignId || !campaignIds.has(adSet.campaignId));
  return (
    <section className="mb-6" aria-labelledby="campaign-drilldown-heading">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div><h2 id="campaign-drilldown-heading" className="text-base font-semibold">Campaign and ad-set drill-down</h2><p className="text-xs text-muted-foreground">{definition.label} delivery, budgets and the learning state returned by Meta.</p></div>
        <span className="text-[11px] text-muted-foreground">Metadata is read from the last successful stored sync.</span>
      </div>
      {state.campaigns.length > 0 ? (
        <div className="space-y-3">{state.campaigns.map((campaign) => <CampaignCard key={campaign.campaignId} row={campaign} adSets={state.adSets} currencyCode={state.meta.currencyCode} timezoneName={state.meta.timezoneName} period={period} />)}</div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">No campaigns with stored insight rows yet. The drill-down will appear after a successful Meta sync returns campaign-level data.</div>
      )}
      {unmatchedAdSets.length > 0 && (
        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-card p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Ad sets without a matched campaign</h3>
            <p className="text-xs text-muted-foreground">Meta returned these ad sets without a campaign relationship in the stored response, so their status, budget and learning state remain visible here.</p>
          </div>
          <div className="space-y-2">{unmatchedAdSets.map((adSet) => <AdSetCard key={adSet.adSetId} row={adSet} currencyCode={state.meta.currencyCode} period={period} />)}</div>
        </div>
      )}
    </section>
  );
}
