"use client";

import { AlertCircle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import type { DashboardPeriod, DashboardState, DataWarning, EvidenceStatus } from "@/lib/state-types";
import { periodDefinition } from "@/lib/dashboard-periods";

const WARNING_STYLE: Record<DataWarning["severity"], { icon: typeof ShieldAlert; className: string }> = {
  alert: { icon: ShieldAlert, className: "border-destructive/30 bg-destructive/5 text-destructive" },
  warn: { icon: AlertCircle, className: "border-amber-500/30 bg-amber-500/5 text-amber-500" },
  info: { icon: Info, className: "border-sky-500/30 bg-sky-500/5 text-sky-500" },
};

function EvidencePill({ status }: { status: EvidenceStatus }) {
  const label = status === "sufficient" ? "Sufficient" : status === "thin" ? "Thin sample" : "Unknown";
  const className = status === "sufficient"
    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
    : status === "thin"
      ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
      : "border-border bg-muted text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${className}`}><CheckCircle2 className="h-3 w-3" /> {label}</span>;
}

export function DataQualityPanel({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const warnings = state.dataWarnings?.[period] || [];
  const periodLabel = periodDefinition(period).label.toLowerCase();
  return (
    <section className="mb-6 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-labelledby="data-quality-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="data-quality-heading" className="text-sm font-semibold">Data quality and attention</h2>
          <p className="mt-1 text-xs text-muted-foreground">Stored Meta evidence is kept separate from interpretation. Missing values are shown as unknown.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <EvidencePill status="sufficient" />
          <EvidencePill status="thin" />
          <EvidencePill status="unknown" />
        </div>
      </div>
      {warnings.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {warnings.map((warning) => {
            const style = WARNING_STYLE[warning.severity];
            const Icon = style.icon;
            return (
              <div key={warning.id} className={`rounded-xl border px-3 py-2.5 ${style.className}`}>
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="text-xs font-semibold">{warning.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{warning.detail}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-xs text-emerald-500"><CheckCircle2 className="h-4 w-4" /> No current data-quality warnings for the {periodLabel} window.</p>
      )}
    </section>
  );
}
