"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ShieldQuestion } from "lucide-react";
import type { DashboardState } from "@/lib/state-types";
import type { RecommendationSeverity, RecommendationType } from "@/lib/recommendation-types";
import { formatMoney } from "@/lib/format";

const TYPE_LABELS: Record<RecommendationType, string> = {
  hold: "Hold",
  monitor: "Monitor",
  possible_tracking_issue: "Possible tracking issue",
  creative_refresh: "Creative refresh",
  pause_candidate: "Pause candidate",
  scale_candidate: "Scale candidate",
  budget_watch: "Budget watch",
};

const SEVERITY_STYLES: Record<RecommendationSeverity, { border: string; text: string; Icon: typeof AlertCircle }> = {
  info: { border: "border-emerald-500/20 bg-emerald-500/5", text: "text-emerald-500", Icon: CheckCircle2 },
  watch: { border: "border-amber-500/20 bg-amber-500/5", text: "text-amber-500", Icon: AlertCircle },
  alert: { border: "border-destructive/30 bg-destructive/5", text: "text-destructive", Icon: AlertTriangle },
};

function formatNumber(value: number | null): string {
  return value == null ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value);
}

function EvidenceLine({ recommendation, currencyCode }: { recommendation: DashboardState["recommendations"][number]; currencyCode: string | null }) {
  const current = recommendation.evidence.current;
  const previous = recommendation.evidence.previous;
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
      <span>Spend {formatMoney(current.spendCents, currencyCode)}</span>
      <span>Leads {formatNumber(current.leads)}</span>
      <span>CPL {formatMoney(current.cplCents, currencyCode)}</span>
      <span>Impressions {formatNumber(current.impressions)}</span>
      <span>vs matched {recommendation.evidence.comparisonDays}d {previous ? "available" : "unavailable"}</span>
      <span>Observed {recommendation.lastSeenAt.replace("T", " ").replace("Z", " UTC")}</span>
    </div>
  );
}

function RecommendationCard({ recommendation, currencyCode }: { recommendation: DashboardState["recommendations"][number]; currencyCode: string | null }) {
  const style = SEVERITY_STYLES[recommendation.severity];
  const Icon = style.Icon;
  return (
    <article className={`rounded-xl border p-4 ${style.border}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold">{TYPE_LABELS[recommendation.type]}</h3>
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{recommendation.confidence} confidence</span>
            <span className="text-xs text-muted-foreground">· {recommendation.target.name}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-foreground/85">{recommendation.reason}</p>
          <p className="mt-2 text-xs font-medium">Next: {recommendation.proposedAction}</p>
          <EvidenceLine recommendation={recommendation} currencyCode={currencyCode} />
        </div>
      </div>
    </article>
  );
}

export function RecommendationPanel({ state }: { state: DashboardState }) {
  const recommendations = state.recommendations ?? [];
  const visible = recommendations;
  return (
    <section id="recommendations-heading" aria-labelledby="recommendations-title" className="mb-6 rounded-2xl border border-primary/20 bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 id="recommendations-title" className="text-base font-semibold">Deterministic recommendations</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Evidence-backed candidates from stored UK Trade Leads data. They never change Meta automatically.</p>
        </div>
        {visible.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{visible.length} active</span>}
      </div>
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          No recommendation is available until a successful stored sync supplies evidence.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((recommendation) => <RecommendationCard key={recommendation.fingerprint} recommendation={recommendation} currencyCode={state.meta.currencyCode} />)}
        </div>
      )}
    </section>
  );
}
