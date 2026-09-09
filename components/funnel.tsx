"use client";

import type { DashboardPeriod, DashboardState } from "@/lib/state-types";
import { currentBucket, periodDefinition } from "@/lib/dashboard-periods";
import { Eye, FormInput, Info, MousePointerClick, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function pct(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function fmtPct(value: number | null) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

type Step = {
  label: string;
  value: number | null;
  base: number | null;
  icon: LucideIcon;
  sourceNote: string;
};

export function Funnel({ state, period = "30d" }: { state: DashboardState; period?: DashboardPeriod }) {
  const funnel = state.funnel;
  const periodBucket = currentBucket(state.scorecard, period);
  const periodLabel = periodDefinition(period).label;
  const metaImpressions = period === "30d" ? funnel.metaPixelImpressions : periodBucket.impressions;
  const metaLinkClicks = period === "30d" ? funnel.metaPixelLinkClicks : periodBucket.linkClicks;
  const metaLeads = period === "30d" ? funnel.leads : periodBucket.leads;
  const callbackFormOpens = period === "30d" ? funnel.callbackFormOpens : null;
  const callbackFormOpenSource = period === "30d" ? "Meta · intent only" : "Meta · select 30d";
  const steps: Step[] = [
    { label: "Impressions", value: metaImpressions, base: metaImpressions, icon: Eye, sourceNote: "Meta" },
    { label: "Link clicks", value: metaLinkClicks, base: metaImpressions, icon: MousePointerClick, sourceNote: "Meta" },
    { label: "Callback form opens", value: callbackFormOpens, base: callbackFormOpens == null ? null : metaLinkClicks, icon: FormInput, sourceNote: callbackFormOpenSource },
    { label: "Meta Lead events", value: metaLeads, base: null, icon: UserRound, sourceNote: "Meta · Lead events" },
  ];
  const max = Math.max(...steps.map((step) => step.value ?? 0), 1);

  return (
    <section className="rounded-xl border border-border bg-card mb-6">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">UKTL website activity (Meta, {periodLabel})</h2>
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          <span>HighLevel outcomes are reported separately</span>
          {(funnel.duplicatesCollapsed > 0 || funnel.testEmailsExcluded > 0) && (
            <span className="inline-flex items-center gap-1 text-emerald-500" title="Deduplication and test-email filter applied">
              <Info className="w-3 h-3" />
              {funnel.duplicatesCollapsed > 0 && `${funnel.duplicatesCollapsed} duplicate${funnel.duplicatesCollapsed > 1 ? "s" : ""} collapsed`}
              {funnel.duplicatesCollapsed > 0 && funnel.testEmailsExcluded > 0 && ", "}
              {funnel.testEmailsExcluded > 0 && `${funnel.testEmailsExcluded} test row${funnel.testEmailsExcluded > 1 ? "s" : ""} excluded`}
            </span>
          )}
        </div>
      </div>
      <div className="px-5 py-4 space-y-2.5">
        {steps.map((step, index) => {
          const widthPct = step.value == null ? 0 : Math.max(2, (step.value / max) * 100);
          const conversionPct = index === 0 ? null : pct(step.value, step.base);
          const Icon = step.icon;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <div className="w-32 sm:w-40 flex items-center gap-2 text-sm shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>{step.label}</span>
              </div>
              <div className="flex-1 h-9 bg-muted/60 rounded-lg relative overflow-hidden min-w-0">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary/50 transition-all" style={{ width: `${widthPct}%` }} />
                <div className="absolute inset-0 flex items-center justify-between px-3 text-sm gap-2">
                  <span className="font-semibold tabular-nums">{step.value == null ? "—" : step.value.toLocaleString("en-GB")}</span>
                  <span className="text-[10px] text-foreground/60 hidden sm:inline truncate">{step.sourceNote}</span>
                </div>
              </div>
              <div className="w-28 sm:w-32 text-right text-xs shrink-0">
                {conversionPct != null ? <><div className="font-semibold text-foreground/70">{fmtPct(conversionPct)}</div><div className="text-[10px] text-muted-foreground">from previous stage</div></> : <div className="text-muted-foreground">top of funnel</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 pb-4 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>Callback form opens: Meta&apos;s automatic <code>SubscribedButtonClick</code> event. It shows a form was opened, not that an enquiry was submitted. An unavailable value means Meta did not return this event; it does not establish zero clicks.</span>
        <span>Meta Lead events can include both enquiry and booking form submissions by the same person. The saved enquiry register groups these by contact. HighLevel contact outcomes above use the <code>contacted</code> tag and sales calendar, so no conversion rate is calculated between Meta events and CRM people.</span>
      </div>
    </section>
  );
}
