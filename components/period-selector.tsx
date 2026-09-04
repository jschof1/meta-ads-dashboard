"use client";

import { Check } from "lucide-react";
import type { DashboardPeriod } from "@/lib/state-types";
import { DASHBOARD_PERIODS, PERIOD_DEFINITIONS } from "@/lib/dashboard-periods";

export function PeriodSelector({
  period,
  onChange,
}: {
  period: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card p-1" aria-label="Reporting period">
      <span className="px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Period</span>
      {DASHBOARD_PERIODS.map((option) => {
        const selected = option === period;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option)}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {selected && <Check className="h-3 w-3" />}
            {PERIOD_DEFINITIONS[option].label}
          </button>
        );
      })}
    </div>
  );
}
