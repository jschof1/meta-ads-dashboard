"use client";

import { UKTL_CONFIG, classifyCpl, findCurrentGate } from "@/lib/targets";
import { formatMoney, formatPercent, targetMoneyLabel } from "@/lib/format";
import type { DashboardState } from "@/lib/state-types";

function fmtMoney(minorUnits: number | null | undefined, currencyCode: string | null) {
  return formatMoney(minorUnits, currencyCode);
}

function fmtPct(value: number | null | undefined) {
  return formatPercent(value);
}

function metricColor(status: ReturnType<typeof classifyCpl>) {
  switch (status) {
    case "green": return "text-emerald-500";
    case "yellow": return "text-amber-500";
    case "red": return "text-destructive";
    default: return "text-muted-foreground";
  }
}

function rateTargetText(target: { target: number | null; acceptable: number | null; minimum: number | null; maximum: number | null }) {
  if (target.target != null) return `Target ${fmtPct(target.target)}`;
  if (target.acceptable != null) return `Acceptable ${fmtPct(target.acceptable)}`;
  if (target.minimum != null || target.maximum != null) {
    return `Range ${fmtPct(target.minimum)}-${fmtPct(target.maximum)}`;
  }
  return "Target not set";
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-semibold ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export function Scorecard({ state }: { state: DashboardState }) {
  const sc = state.scorecard;
  const currencyCode = state.meta.currencyCode;
  const dsl = state.meta.daysSinceLaunch;
  const gate = dsl != null ? findCurrentGate(dsl) : null;
  const cplStatus = classifyCpl(sc.last7.cplCents);
  const learningPct = sc.learningProgress == null ? null : Math.round(sc.learningProgress * 100);
  const { targets } = UKTL_CONFIG;

  const dailyBudget = sc.budget.dailyCents;
  const monthlySpend = sc.last30.spendCents;
  const monthlyBudget = sc.budget.monthlyCents;
  const learningValue = sc.leadsThisWeek == null
    ? "—"
    : sc.learningLeadsTarget == null
      ? String(sc.leadsThisWeek)
      : `${sc.leadsThisWeek}/${sc.learningLeadsTarget}`;

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <Card
        label="Today spend"
        value={fmtMoney(sc.today.spendCents, currencyCode)}
        sub={dailyBudget == null ? "Daily budget not set" : `Plan: ${fmtMoney(dailyBudget, currencyCode)}/day`}
      />
      <Card
        label="MTD spend"
        value={fmtMoney(monthlySpend, currencyCode)}
        sub={monthlyBudget == null ? "Monthly budget not set" : `Budget: ${fmtMoney(monthlyBudget, currencyCode)}`}
      />
      <Card
        label="7d CPL"
        value={fmtMoney(sc.last7.cplCents, currencyCode)}
        sub={targets.cpl.targetMinorUnits == null ? "CPL target not set" : `Target ≤ ${targetMoneyLabel(targets.cpl.targetMinorUnits, currencyCode)}`}
        accent={metricColor(cplStatus)}
      />
      <Card
        label="Learning phase"
        value={learningValue}
        sub={sc.learningLeadsTarget == null
          ? "Learning lead target not set"
          : learningPct == null ? "Lead data unavailable" : `${learningPct}% to target`}
      />
      <Card
        label="7d link CTR"
        value={fmtPct(sc.last7.ctrLink)}
        sub={rateTargetText(targets.linkCtr)}
      />
      <Card
        label="7d CPM"
        value={fmtMoney(sc.last7.cpmCents, currencyCode)}
        sub={targets.cpm.targetMinorUnits == null ? "CPM target not set" : `Target ≤ ${targetMoneyLabel(targets.cpm.targetMinorUnits, currencyCode)}`}
      />
      <Card
        label="Days since launch"
        value={dsl == null ? "not set" : String(dsl)}
        sub={state.meta.launchDate ? `Launched ${state.meta.launchDate}` : "Launch date not set"}
      />
      <Card
        label="Decision gate"
        value={gate ? `Day ${gate.day}` : "Not configured"}
        sub={gate?.label || (dsl == null ? "Launch date not set" : "No decision gate configured")}
      />
    </section>
  );
}
