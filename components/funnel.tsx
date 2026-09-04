"use client";

import type { DashboardState } from "@/lib/state-types";
import { UKTL_CONFIG, type FunnelStageKey } from "@/lib/targets";
import { Eye, MousePointerClick, UserRound, UserCheck, Phone, Trophy, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function pct(numerator: number | null, denominator: number | null) {
  if (numerator == null || denominator == null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function fmtPct(value: number | null) {
  if (value == null) return "—";
  return `${value.toFixed(1)}%`;
}

type Step = {
  key: FunnelStageKey;
  label: string;
  value: number | null;
  base: number | null;
  icon: LucideIcon;
  sourceNote: string;
};

function stageLabel(key: FunnelStageKey): string {
  return UKTL_CONFIG.funnel.find((stage) => stage.key === key)?.label ?? key;
}

export function Funnel({ state }: { state: DashboardState }) {
  const f = state.funnel;
  const crmNote = f.crmConfigured ? "CRM" : "CRM data not configured";
  const steps: Step[] = [
    { key: "lead", label: "Impressions", value: f.metaPixelImpressions, base: f.metaPixelImpressions, icon: Eye, sourceNote: "Meta" },
    { key: "lead", label: "Link clicks", value: f.metaPixelLinkClicks, base: f.metaPixelImpressions, icon: MousePointerClick, sourceNote: "Meta" },
    { key: "lead", label: stageLabel("lead"), value: f.leads, base: f.metaPixelLinkClicks, icon: UserRound, sourceNote: "Meta lead result" },
    { key: "contacted", label: stageLabel("contacted"), value: f.contacted, base: f.leads, icon: UserCheck, sourceNote: crmNote },
    { key: "qualified", label: stageLabel("qualified"), value: f.qualified, base: f.contacted, icon: UserCheck, sourceNote: crmNote },
    { key: "callBooked", label: stageLabel("callBooked"), value: f.callsBooked, base: f.qualified, icon: Phone, sourceNote: crmNote },
    { key: "callAttended", label: stageLabel("callAttended"), value: f.callsAttended, base: f.callsBooked, icon: Phone, sourceNote: crmNote },
    { key: "wonCustomer", label: stageLabel("wonCustomer"), value: f.wonCustomers, base: f.callsAttended, icon: Trophy, sourceNote: crmNote },
  ];

  const max = Math.max(...steps.map((step) => step.value ?? 0), 1);
  const lostLabel = stageLabel("lost");

  return (
    <section className="rounded-xl border border-border bg-card mb-6">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold">UKTL conversion path (paid Meta, last 30d)</h2>
        <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
          <span>{f.crmConfigured ? "CRM attribution connected" : "CRM attribution not configured"}</span>
          {(f.duplicatesCollapsed > 0 || f.testEmailsExcluded > 0) && (
            <span className="inline-flex items-center gap-1 text-emerald-500" title="Deduplication and test-email filter applied">
              <Info className="w-3 h-3" />
              {f.duplicatesCollapsed > 0 && `${f.duplicatesCollapsed} duplicate${f.duplicatesCollapsed > 1 ? "s" : ""} collapsed`}
              {f.duplicatesCollapsed > 0 && f.testEmailsExcluded > 0 && ", "}
              {f.testEmailsExcluded > 0 && `${f.testEmailsExcluded} test row${f.testEmailsExcluded > 1 ? "s" : ""} excluded`}
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
            <div key={`${step.key}-${step.label}`} className="flex items-center gap-3">
              <div className="w-32 sm:w-40 flex items-center gap-2 text-sm shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <span>{step.label}</span>
              </div>

              <div className="flex-1 h-9 bg-muted/60 rounded-lg relative overflow-hidden min-w-0">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary/50 transition-all"
                  style={{ width: `${widthPct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-3 text-sm gap-2">
                  <span className="font-semibold tabular-nums">{step.value == null ? "—" : step.value.toLocaleString("en-GB")}</span>
                  <span className="text-[10px] text-foreground/60 hidden sm:inline truncate">{step.sourceNote}</span>
                </div>
              </div>

              <div className="w-28 sm:w-32 text-right text-xs shrink-0">
                {conversionPct != null ? (
                  <>
                    <div className="font-semibold text-foreground/70">{fmtPct(conversionPct)}</div>
                    <div className="text-[10px] text-muted-foreground">from previous stage</div>
                  </>
                ) : (
                  <div className="text-muted-foreground">top of funnel</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-5 pb-4 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>{lostLabel}: {f.lostCustomers == null ? "CRM data not configured" : f.lostCustomers.toLocaleString("en-GB")}</span>
        {!f.crmConfigured && <span>Downstream stages stay unknown until CRM attribution is configured.</span>}
      </div>
    </section>
  );
}
