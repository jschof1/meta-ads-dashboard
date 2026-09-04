"use client";

import { UKTL_CONFIG, classifyCpl, findCurrentGate } from "@/lib/targets";
import { formatCount, formatMoney, formatPercent, targetMoneyLabel } from "@/lib/format";
import { comparisonInstruction, comparisonIsComparable, currentBucket, comparisonBucket, periodDefinition } from "@/lib/dashboard-periods";
import { evidenceForBucket, frequencyEvidenceForBucket, ratioDelta } from "@/lib/dashboard-metrics";
import type { DashboardPeriod, EntityEvidence, DashboardState } from "@/lib/state-types";

function metricColor(status: ReturnType<typeof classifyCpl>, evidence: EntityEvidence) {
  if (evidence.status !== "sufficient") return "text-muted-foreground";
  switch (status) {
    case "green": return "text-emerald-500";
    case "yellow": return "text-amber-500";
    case "red": return "text-destructive";
    default: return "text-muted-foreground";
  }
}

function rateTargetText(target: { target: number | null; acceptable: number | null; minimum: number | null; maximum: number | null }) {
  if (target.target != null) return `Target ${formatPercent(target.target)}`;
  if (target.acceptable != null) return `Acceptable ${formatPercent(target.acceptable)}`;
  if (target.minimum != null || target.maximum != null) {
    return `Range ${formatPercent(target.minimum)}-${formatPercent(target.maximum)}`;
  }
  return "Target not set";
}

function deltaText(current: number | null, comparison: number | null, direction: "lower" | "higher" | "neutral") {
  const delta = ratioDelta(current, comparison);
  if (delta == null) return { text: "No matched baseline", className: "text-muted-foreground" };
  const improved = direction === "lower" ? delta < 0 : direction === "higher" ? delta > 0 : false;
  const worsened = direction !== "neutral" && !improved && delta !== 0;
  return {
    text: `${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} ${Math.abs(delta).toFixed(1)}% vs matched period`,
    className: direction === "neutral" ? "text-muted-foreground" : improved ? "text-emerald-500" : worsened ? "text-destructive" : "text-muted-foreground",
  };
}

function EvidenceNote({ evidence }: { evidence: EntityEvidence }) {
  const label = evidence.status === "sufficient" ? "Evidence sufficient" : evidence.status === "thin" ? "Thin sample" : "Evidence unknown";
  const className = evidence.status === "sufficient" ? "text-emerald-500" : evidence.status === "thin" ? "text-amber-500" : "text-muted-foreground";
  return <span className={className} title={evidence.reason}>{label}</span>;
}

function Card({
  label,
  value,
  sub,
  current,
  comparison,
  direction,
  evidence,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  current: number | null;
  comparison: number | null;
  direction: "lower" | "higher" | "neutral";
  evidence: EntityEvidence;
  accent?: string;
}) {
  const delta = deltaText(current, comparison, direction);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      <div className={`mt-2 text-[11px] ${delta.className}`}>{delta.text}</div>
      <div className="mt-1 text-[11px]"><EvidenceNote evidence={evidence} /></div>
    </div>
  );
}

export function Scorecard({ state, period }: { state: DashboardState; period: DashboardPeriod }) {
  const sc = state.scorecard;
  const currencyCode = state.meta.currencyCode;
  const definition = periodDefinition(period);
  const selected = currentBucket(sc, period);
  const comparison = comparisonBucket(sc, period);
  const selectedComparison = comparisonIsComparable(period, state.meta.mtdComparisonComparable) ? comparison : null;
  const mtdComparison = state.meta.mtdComparisonComparable ? sc.previousMtd : null;
  const selectedEvidence = evidenceForBucket(selected);
  const todayEvidence = evidenceForBucket(sc.today);
  const mtdEvidence = evidenceForBucket(sc.mtd);
  const dsl = state.meta.daysSinceLaunch;
  const gate = dsl != null ? findCurrentGate(dsl) : null;
  const cplStatus = classifyCpl(selected.cplCents);
  const learningPct = sc.learningProgress == null ? null : Math.round(sc.learningProgress * 100);
  const { targets } = UKTL_CONFIG;
  const learningValue = sc.leadsThisWeek == null
    ? "—"
    : sc.learningLeadsTarget == null
      ? String(sc.leadsThisWeek)
      : `${sc.leadsThisWeek}/${sc.learningLeadsTarget}`;

  return (
    <section className="mb-6" aria-labelledby="scorecard-heading">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="scorecard-heading" className="text-base font-semibold">Performance scorecard</h2>
          <p className="text-xs text-muted-foreground">{definition.label} metrics · {comparisonInstruction(period, state.meta.mtdComparisonComparable)}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">Costs are in the Meta account currency.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card
          label="Today spend"
          value={formatMoney(sc.today.spendCents, currencyCode)}
          sub={targets.dailyBudgetMinorUnits == null ? "Daily budget not set" : `Plan: ${formatMoney(targets.dailyBudgetMinorUnits, currencyCode)}/day`}
          current={sc.today.spendCents}
          comparison={sc.yesterday.spendCents}
          direction="neutral"
          evidence={todayEvidence}
        />
        <Card
          label="MTD spend"
          value={formatMoney(sc.mtd.spendCents, currencyCode)}
          sub={`${state.scorecard.spendStatus.label}. ${state.scorecard.spendStatus.detail}`}
          current={sc.mtd.spendCents}
          comparison={mtdComparison?.spendCents ?? null}
          direction="neutral"
          evidence={mtdEvidence}
        />
        <Card
          label={`${definition.label} leads`}
          value={formatCount(selected.leads)}
          sub="Meta-reported lead result"
          current={selected.leads}
          comparison={selectedComparison?.leads ?? null}
          direction="higher"
          evidence={selectedEvidence}
        />
        <Card
          label={`${definition.label} CPL`}
          value={formatMoney(selected.cplCents, currencyCode)}
          sub={targets.cpl.targetMinorUnits == null ? "CPL target not set" : `Target ≤ ${targetMoneyLabel(targets.cpl.targetMinorUnits, currencyCode)}`}
          current={selected.cplCents}
          comparison={selectedComparison?.cplCents ?? null}
          direction="lower"
          evidence={selectedEvidence}
          accent={metricColor(cplStatus, selectedEvidence)}
        />
        <Card
          label={`${definition.label} CPM`}
          value={formatMoney(selected.cpmCents, currencyCode)}
          sub={targets.cpm.targetMinorUnits == null ? "CPM target not set" : `Target ≤ ${targetMoneyLabel(targets.cpm.targetMinorUnits, currencyCode)}`}
          current={selected.cpmCents}
          comparison={selectedComparison?.cpmCents ?? null}
          direction="lower"
          evidence={selectedEvidence}
        />
        <Card
          label={`${definition.label} link CTR`}
          value={formatPercent(selected.ctrLink)}
          sub={rateTargetText(targets.linkCtr)}
          current={selected.ctrLink}
          comparison={selectedComparison?.ctrLink ?? null}
          direction="higher"
          evidence={selectedEvidence}
        />
        <Card
          label={`${definition.label} CPC`}
          value={formatMoney(selected.cpcCents, currencyCode)}
          sub="Spend divided by all clicks"
          current={selected.cpcCents}
          comparison={selectedComparison?.cpcCents ?? null}
          direction="lower"
          evidence={selectedEvidence}
        />
        <Card
          label={`${definition.label} frequency`}
          value={selected.frequency == null ? "—" : selected.frequency.toFixed(2)}
          sub="Weighted daily audience saturation signal"
          current={selected.frequency}
          comparison={selectedComparison?.frequency ?? null}
          direction="neutral"
          evidence={frequencyEvidenceForBucket(selected)}
        />
        <Card
          label="Learning phase"
          value={learningValue}
          sub={sc.learningLeadsTarget == null ? "Weekly learning target not set" : learningPct == null ? "Lead data unavailable" : `${learningPct}% to target`}
          current={sc.leadsThisWeek}
          comparison={null}
          direction="higher"
          evidence={evidenceForBucket(sc.last7)}
        />
        <Card
          label="Decision gate"
          value={gate ? `Day ${gate.day}` : "Not configured"}
          sub={gate?.label || (dsl == null ? "Launch date not set" : "No decision gate configured")}
          current={null}
          comparison={null}
          direction="neutral"
          evidence={selectedEvidence}
        />
      </div>
    </section>
  );
}
