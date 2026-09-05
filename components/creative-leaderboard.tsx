"use client";

import { useState } from "react";
import type { AdRow, AdVerdictTag, DashboardPeriod, DashboardState } from "@/lib/state-types";
import { currentBucket, periodDefinition } from "@/lib/dashboard-periods";
import { evidenceForBucket } from "@/lib/dashboard-metrics";
import { classifyAd } from "@/lib/targets";
import { formatCount, formatDateTime, formatMoney, formatPercent, formatStoredDate } from "@/lib/format";
import { safeHttpUrl } from "@/lib/safe-url";
import { ExternalLink, Flame, ImageOff, Video } from "lucide-react";

function statusBadge(status: string) {
  const value = status.toUpperCase();
  if (value.includes("ACTIVE")) return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  if (value.includes("PAUSED")) return "bg-muted text-muted-foreground border-border";
  return "bg-amber-500/10 text-amber-500 border-amber-500/20";
}

const VERDICT_STYLES: Record<AdVerdictTag, { label: string; cls: string }> = {
  winner: { label: "Winner", cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30" },
  performing: { label: "Performing", cls: "bg-sky-500/10 text-sky-500 border-sky-500/30" },
  watch: { label: "Watch", cls: "bg-amber-500/10 text-amber-500 border-amber-500/30" },
  cull: { label: "Cull", cls: "bg-red-500/10 text-destructive border-destructive/30" },
  too_early: { label: "Not conclusive", cls: "bg-muted text-muted-foreground border-border" },
  unknown: { label: "Target not set", cls: "bg-muted text-muted-foreground border-border" },
};

function FatigueMeter({ score, reason }: { score: number; reason: string }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.7 ? "text-destructive bg-destructive/20"
    : score >= 0.4 ? "text-amber-500 bg-amber-500/20"
      : score > 0 ? "text-emerald-500 bg-emerald-500/20"
        : "text-muted-foreground bg-muted";
  return (
    <span className="flex items-center gap-1.5" title={reason}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={`block h-full ${color.split(" ")[1]}`} style={{ width: `${pct}%` }} /></span>
      {score >= 0.5 && <Flame className={`h-3.5 w-3.5 ${color.split(" ")[0]}`} />}
      <span className="text-[11px] text-muted-foreground">{pct}%</span>
    </span>
  );
}

function selectedVerdict(ad: AdRow, period: DashboardPeriod) {
  const bucket = currentBucket(ad.periods, period);
  const evidence = ad.evidence?.[period] ?? evidenceForBucket(bucket);
  if (evidence.status !== "sufficient") return { verdict: "too_early" as const, reason: evidence.reason, evidence };
  return {
    ...classifyAd({
      spendCents: bucket.spendCents,
      leads: bucket.leads,
      cplCents: bucket.cplCents,
      ctrLink: bucket.ctrLink,
    }),
    evidence,
  };
}

function EvidenceLabel({ status, reason }: { status: "unknown" | "thin" | "sufficient"; reason: string }) {
  const label = status === "sufficient" ? "Evidence sufficient" : status === "thin" ? "Thin sample" : "Evidence unknown";
  const className = status === "sufficient" ? "text-emerald-500" : status === "thin" ? "text-amber-500" : "text-muted-foreground";
  return <span className={className} title={reason}>{label}</span>;
}

function Preview({ ad }: { ad: AdRow }) {
  const primaryImage = safeHttpUrl(ad.thumbnailUrl) || safeHttpUrl(ad.imageUrl);
  const fallbackImage = safeHttpUrl(ad.thumbnailUrl) && safeHttpUrl(ad.imageUrl) && ad.thumbnailUrl !== ad.imageUrl
    ? safeHttpUrl(ad.imageUrl)
    : null;
  const [imageState, setImageState] = useState<"primary" | "fallback" | "unavailable">(primaryImage ? "primary" : "unavailable");
  const image = imageState === "primary" ? primaryImage : imageState === "fallback" ? fallbackImage : null;
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={`Preview of ${ad.adName}`}
        onError={() => setImageState(fallbackImage && imageState === "primary" ? "fallback" : "unavailable")}
        className="h-28 w-full rounded-xl bg-muted object-cover sm:h-36"
      />
    );
  }
  if (ad.videoId) {
    return <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-xl bg-muted text-xs text-muted-foreground sm:h-36"><Video className="h-5 w-5" /> Video preview unavailable</div>;
  }
  return <div className="flex h-28 w-full flex-col items-center justify-center gap-1 rounded-xl bg-muted text-xs text-muted-foreground sm:h-36"><ImageOff className="h-5 w-5" /> Preview unavailable</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/50 px-2.5 py-2"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div></div>;
}

function CreativeCard({ ad, period, currencyCode, timezoneName, adManagerUrl }: { ad: AdRow; period: DashboardPeriod; currencyCode: string | null; timezoneName: string | null; adManagerUrl: string | null }) {
  const bucket = currentBucket(ad.periods, period);
  const decision = selectedVerdict(ad, period);
  const verdictStyle = VERDICT_STYLES[decision.verdict];
  const destination = safeHttpUrl(ad.destinationUrl);
  const format = ad.format ? ad.format[0].toUpperCase() + ad.format.slice(1) : "Format unknown";
  return (
    <article className="grid gap-4 rounded-2xl border border-border bg-card p-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
      <div><Preview ad={ad} /><div className="mt-2 text-center text-[11px] text-muted-foreground">{format}{ad.creativeId ? ` · ${ad.creativeId}` : ""}</div></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{ad.adName}</h3><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{ad.adId}</p></div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!ad.isCurrent && <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">Not current in latest sync</span>}
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusBadge(ad.status)}`}>{ad.status.replace(/_/g, " ")}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] ${verdictStyle.cls}`} title={decision.reason}>{verdictStyle.label}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label={`${period} spend`} value={formatMoney(bucket.spendCents, currencyCode)} />
          <Metric label={`${period} leads`} value={formatCount(bucket.leads)} />
          <Metric label={`${period} CPL`} value={formatMoney(bucket.cplCents, currencyCode)} />
          <Metric label="Link CTR" value={formatPercent(bucket.ctrLink)} />
          <Metric label="CPC" value={formatMoney(bucket.cpcCents, currencyCode)} />
          <Metric label="Avg daily frequency" value={bucket.frequency == null ? "—" : bucket.frequency.toFixed(2)} />
        </div>
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Creative content</p>{ad.title && <p className="mt-1 truncate font-medium">{ad.title}</p>}{ad.body ? <p className="mt-1 line-clamp-3 whitespace-pre-line leading-relaxed text-foreground/80">{ad.body}</p> : <p className="mt-1 text-muted-foreground">Body text not returned</p>}{ad.callToAction && <p className="mt-1 text-muted-foreground">CTA: <span className="text-foreground/80">{ad.callToAction.replace(/_/g, " ")}</span></p>}</div>
          <div className="space-y-1 text-muted-foreground"><p><span className="font-medium text-foreground/80">Previous change:</span> {ad.lastChangeAt ? formatDateTime(ad.lastChangeAt, timezoneName) : "No provider change timestamp returned"}</p><p><span className="font-medium text-foreground/80">Evidence:</span> <EvidenceLabel status={decision.evidence.status} reason={decision.evidence.reason} /></p><p><span className="font-medium text-foreground/80">Fatigue diagnostic:</span> <FatigueMeter score={ad.fatigueScore} reason={ad.fatigueReason} /></p>{destination && <p className="truncate"><span className="font-medium text-foreground/80">Destination:</span> <a href={destination} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open landing page</a></p>}</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{ad.daysActive == null ? "Days active unknown" : `${ad.daysActive} day${ad.daysActive === 1 ? "" : "s"} active`}</span>{ad.firstSeenDate && <span>First stored impression {formatStoredDate(ad.firstSeenDate, timezoneName)}</span>}{adManagerUrl && <a href={adManagerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open in Ads Manager <ExternalLink className="h-3 w-3" /></a>}</div>
      </div>
    </article>
  );
}

export function CreativeLeaderboard({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const definition = periodDefinition(period);
  const ads = [...state.ads].sort((left, right) => {
    const leftCpl = currentBucket(left.periods, period).cplCents;
    const rightCpl = currentBucket(right.periods, period).cplCents;
    if (leftCpl == null && rightCpl == null) return (currentBucket(right.periods, period).spendCents ?? -1) - (currentBucket(left.periods, period).spendCents ?? -1);
    if (leftCpl == null) return 1;
    if (rightCpl == null) return -1;
    return leftCpl - rightCpl;
  });
  const adManagerBase = state.meta.adAccountId ? `https://business.facebook.com/adsmanager/manage/ads?act=${state.meta.adAccountId.replace(/^act_/, "")}` : null;
  return (
    <section className="mb-6" aria-labelledby="creative-leaderboard-heading">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"><div><h2 id="creative-leaderboard-heading" className="text-base font-semibold">Creative leaderboard</h2><p className="text-xs text-muted-foreground">{definition.label} metrics, stored creative content and evidence-backed verdicts. Thin samples stay neutral.</p></div><p className="text-[11px] text-muted-foreground">Sorted by {definition.label} CPL.</p></div>
      {ads.length === 0 ? <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">No ads with stored insights yet. After a successful Meta sync returns ad-level rows, creatives appear here.</div> : <div className="space-y-3">{ads.map((ad) => <CreativeCard key={ad.adId} ad={ad} period={period} currencyCode={state.meta.currencyCode} timezoneName={state.meta.timezoneName} adManagerUrl={adManagerBase ? `${adManagerBase}&selected_ad_ids=${encodeURIComponent(ad.adId)}` : null} />)}</div>}
    </section>
  );
}
