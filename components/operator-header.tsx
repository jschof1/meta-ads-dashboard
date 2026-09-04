"use client";

import { Activity, Database, Globe2 } from "lucide-react";
import type { DashboardPeriod, DashboardState } from "@/lib/state-types";
import { formatDateTime } from "@/lib/format";
import { comparisonInstruction, PERIOD_DEFINITIONS } from "@/lib/dashboard-periods";

const STATUS_LABEL: Record<DashboardState["meta"]["syncState"], string> = {
  never: "Awaiting first sync",
  running: "Sync in progress",
  fresh: "Stored data is fresh",
  stale: "Stored data is stale",
  failed: "Latest sync failed",
};

const STATUS_CLASS: Record<DashboardState["meta"]["syncState"], string> = {
  never: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  running: "border-sky-500/30 bg-sky-500/10 text-sky-500",
  fresh: "border-emerald-500/30 bg-emerald-500/10 text-emerald-500",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-500",
  failed: "border-destructive/30 bg-destructive/10 text-destructive",
};

export function OperatorHeader({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const definition = PERIOD_DEFINITIONS[period];
  const accountName = state.meta.accountName || "UK Trade Leads account";
  return (
    <section className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Operator overview</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Are the ads healthy?</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {accountName} · {definition.label} performance. {comparisonInstruction(period, state.meta.mtdComparisonComparable)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${STATUS_CLASS[state.meta.syncState]}`}>
          <Activity className="h-3.5 w-3.5" />
          {STATUS_LABEL[state.meta.syncState]}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1" title={state.meta.timezoneName || "Account timezone pending"}>
          <Globe2 className="h-3.5 w-3.5" />
          {state.meta.currencyCode || "Currency pending"} · {state.meta.timezoneName || "Timezone pending"}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1" title={state.meta.lastSuccessfulSyncAt ? formatDateTime(state.meta.lastSuccessfulSyncAt, state.meta.timezoneName) : "No successful sync"}>
          <Database className="h-3.5 w-3.5" />
          {state.meta.lastSuccessfulSyncAt ? `Read at ${formatDateTime(state.meta.lastSuccessfulSyncAt, state.meta.timezoneName)}` : "No stored read yet"}
        </span>
      </div>
    </section>
  );
}
