// Pure-function insights helpers: fatigue scoring, anomaly detection,
// decision triggers, and campaign phase. These run inside the API route - no
// I/O or live provider calls.

import { formatMoney } from "./format";
import { UKTL_CONFIG } from "./uktl-config";
import { classifyCpl, findCurrentGate } from "./targets";
import type {
  Anomaly,
  CampaignPhase,
  DecisionTrigger,
  HeatmapCell,
  TrendPoint,
} from "./state-types";

// ---------- Fatigue ----------
// Fatigue is a diagnostic combination of audience repetition and weakening
// engagement. A CPL contribution is used only when UKTL has supplied a
// maximum; it is never inferred from an upstream template.
export function scoreFatigue(input: {
  frequency: number | null;
  ctrLink: number | null;
  cplCents: number | null;
  daysActive: number | null;
  spendCents: number | null;
}): { score: number; reason: string } {
  const { frequency, ctrLink, cplCents, daysActive, spendCents } = input;
  const minimumSpend = UKTL_CONFIG.evidence.minSpendMinorUnits;

  if (
    spendCents == null
    || spendCents <= 0
    || frequency == null
    || ctrLink == null
    || (minimumSpend != null && spendCents < minimumSpend)
  ) {
    return { score: 0, reason: "Not enough stored evidence to read fatigue yet" };
  }

  let score = 0;
  const reasons: string[] = [];
  const frequencyRules = UKTL_CONFIG.frequency;

  if (frequency >= frequencyRules.alertAbove) {
    score += 0.5;
    reasons.push(`frequency ${frequency.toFixed(2)}`);
  } else if (frequency >= frequencyRules.watchAbove) {
    score += 0.25;
    reasons.push(`frequency ${frequency.toFixed(2)} (warming)`);
  }

  if (ctrLink < frequencyRules.ctrAlertBelow) {
    score += 0.3;
    reasons.push(`CTR ${(ctrLink * 100).toFixed(2)}% below diagnostic floor`);
  } else if (ctrLink < frequencyRules.ctrWatchBelow) {
    score += 0.15;
    reasons.push(`CTR ${(ctrLink * 100).toFixed(2)}% soft`);
  }

  const cplMaximum = UKTL_CONFIG.targets.cpl.maximumMinorUnits;
  if (cplCents != null && cplMaximum != null && cplCents > cplMaximum) {
    score += 0.2;
    reasons.push("CPL above configured maximum");
  }

  if (daysActive != null && daysActive >= 7) {
    score += 0.1;
    reasons.push(`${daysActive}d active`);
  }

  score = Math.min(1, score);
  if (score === 0) return { score: 0, reason: "Healthy" };
  return { score, reason: reasons.join(" · ") };
}

// ---------- Anomalies ----------
// Compare the latest day to the trailing 7-day mean. This is a historical
// comparison and does not require a business target to be configured.
export function detectAnomalies(trend: TrendPoint[]): Anomaly[] {
  if (trend.length < 4) return [];
  const out: Anomaly[] = [];
  const latest = trend[trend.length - 1];
  const baseline = trend.slice(Math.max(0, trend.length - 8), trend.length - 1);
  if (baseline.length < 3) return [];

  function avg(pick: (p: TrendPoint) => number | null): number | null {
    const vals = baseline.map(pick).filter((v): v is number => v != null && v > 0);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function delta(latestVal: number | null, baseVal: number | null): number | null {
    if (latestVal == null || baseVal == null || baseVal === 0) return null;
    return (latestVal - baseVal) / baseVal;
  }

  // For CPM and CPL, lower is better, so drops are positive information and
  // spikes are warnings.
  const cpmDelta = delta(latest.cpmCents, avg((p) => p.cpmCents));
  if (cpmDelta != null && Math.abs(cpmDelta) >= 0.2) {
    const isPositive = cpmDelta < 0;
    out.push({
      metric: "cpm",
      direction: cpmDelta > 0 ? "up" : "down",
      changePct: Math.round(cpmDelta * 100),
      date: latest.date,
      message: cpmDelta > 0
        ? `CPM spiked ${Math.abs(Math.round(cpmDelta * 100))}% vs 7d avg. Auction heating up - watch creative fatigue.`
        : `CPM dropped ${Math.abs(Math.round(cpmDelta * 100))}% vs 7d avg. Cheaper reach - good signal.`,
      severity: isPositive ? "info" : Math.abs(cpmDelta) >= 0.4 ? "alert" : "warn",
    });
  }

  const cplDelta = delta(latest.cplCents, avg((p) => p.cplCents));
  if (cplDelta != null && Math.abs(cplDelta) >= 0.2) {
    const isPositive = cplDelta < 0;
    out.push({
      metric: "cpl",
      direction: cplDelta > 0 ? "up" : "down",
      changePct: Math.round(cplDelta * 100),
      date: latest.date,
      message: cplDelta > 0
        ? `CPL spiked ${Math.abs(Math.round(cplDelta * 100))}% vs 7d avg. Costlier leads - check creatives and lead quality.`
        : `CPL improved ${Math.abs(Math.round(cplDelta * 100))}% vs 7d avg. Cheaper leads - compare quality before scaling.`,
      severity: isPositive ? "info" : Math.abs(cplDelta) >= 0.4 ? "alert" : "warn",
    });
  }

  // For CTR, higher is better. Jumps are positive information and falls are
  // warnings.
  const ctrDelta = delta(latest.ctrLink, avg((p) => p.ctrLink));
  if (ctrDelta != null && Math.abs(ctrDelta) >= 0.25) {
    const isPositive = ctrDelta > 0;
    out.push({
      metric: "ctr",
      direction: ctrDelta > 0 ? "up" : "down",
      changePct: Math.round(ctrDelta * 100),
      date: latest.date,
      message: ctrDelta > 0
        ? `Link CTR jumped ${Math.abs(Math.round(ctrDelta * 100))}% vs 7d avg. Creative is connecting.`
        : `Link CTR fell ${Math.abs(Math.round(ctrDelta * 100))}% vs 7d avg. Hook is losing audience.`,
      severity: isPositive ? "info" : "warn",
    });
  }

  return out;
}

// ---------- Heatmap ----------
// 30-day intensity heatmap. Cost intensity is relative to the observed
// period, so it stays useful when no CPL target has been supplied.
export function buildHeatmap(trend: TrendPoint[]): HeatmapCell[] {
  if (trend.length === 0) return [];
  const maxLeads = Math.max(...trend.map((p) => p.leads ?? 0), 1);
  const observedCpl = trend.flatMap((p) => p.cplCents == null ? [] : [p.cplCents]);
  const lowestCpl = observedCpl.length > 0 ? Math.min(...observedCpl) : null;
  const highestCpl = observedCpl.length > 0 ? Math.max(...observedCpl) : null;
  const cplSpan = lowestCpl != null && highestCpl != null ? highestCpl - lowestCpl : 0;

  return trend.map((p) => {
    const cplScore = p.cplCents == null || lowestCpl == null || highestCpl == null
      ? 0
      : cplSpan === 0 ? 1 : 1 - ((p.cplCents - lowestCpl) / cplSpan);
    const leadScore = (p.leads ?? 0) / maxLeads;
    const intensity = Math.min(1, 0.6 * cplScore + 0.4 * leadScore);
    return {
      date: p.date,
      intensity,
      spendCents: p.spendCents,
      leads: p.leads,
      cplCents: p.cplCents,
    };
  });
}

// ---------- Decision triggers ----------
export function buildTriggers(input: {
  cplCentsLast7: number | null;
  currencyCode?: string | null;
  frequencyLast7: number | null;
  leadsThisWeek: number | null;
  daysSinceLaunch: number | null;
  ads: { fatigueScore: number; adName: string }[];
}): DecisionTrigger[] {
  const targets = UKTL_CONFIG.targets;
  const triggers: DecisionTrigger[] = [];
  const cplStatus = classifyCpl(input.cplCentsLast7);
  const formattedCpl = input.cplCentsLast7 == null
    ? null
    : formatMoney(input.cplCentsLast7, input.currencyCode);

  if (input.cplCentsLast7 == null) {
    triggers.push({
      id: "cpl-band",
      label: "CPL target",
      status: "pending",
      detail: "CPL is unavailable - waiting for stored lead evidence.",
    });
  } else if (cplStatus === "unknown") {
    triggers.push({
      id: "cpl-band",
      label: "CPL target",
      status: "pending",
      detail: "No CPL target is configured; historical comparison remains available.",
    });
  } else {
    const status = cplStatus === "green" ? "ok" : cplStatus === "yellow" ? "watch" : "alert";
    triggers.push({
      id: "cpl-band",
      label: "CPL target",
      status,
      detail: `${formattedCpl ?? "CPL available"} is ${cplStatus === "green" ? "inside" : cplStatus === "yellow" ? "within the acceptable" : "above the"} configured range.`,
    });
  }

  const frequencyRules = UKTL_CONFIG.frequency;
  if (input.frequencyLast7 == null) {
    triggers.push({ id: "freq", label: "Frequency watch", status: "pending", detail: "Frequency is unavailable for this period." });
  } else if (input.frequencyLast7 >= frequencyRules.alertAbove) {
    triggers.push({ id: "freq", label: "Frequency watch", status: "alert", detail: `Frequency ${input.frequencyLast7.toFixed(2)} - audience may be saturating; refresh creative.` });
  } else if (input.frequencyLast7 >= frequencyRules.watchAbove) {
    triggers.push({ id: "freq", label: "Frequency watch", status: "watch", detail: `Frequency ${input.frequencyLast7.toFixed(2)} is approaching the configured watch level.` });
  } else {
    triggers.push({ id: "freq", label: "Frequency watch", status: "ok", detail: `Frequency ${input.frequencyLast7.toFixed(2)} is below the configured watch level.` });
  }

  const learningTarget = targets.learningLeadsPerWeek;
  if (learningTarget == null) {
    triggers.push({ id: "learning", label: "Learning phase", status: "pending", detail: "No learning lead target is configured." });
  } else if (input.leadsThisWeek == null) {
    triggers.push({ id: "learning", label: "Learning phase", status: "pending", detail: "Lead data is unavailable for this period." });
  } else if (input.leadsThisWeek >= learningTarget) {
    triggers.push({ id: "learning", label: "Learning phase", status: "ok", detail: `${input.leadsThisWeek}/${learningTarget} leads this week. Target reached.` });
  } else {
    triggers.push({
      id: "learning",
      label: "Learning phase",
      status: input.leadsThisWeek >= learningTarget * 0.5 ? "watch" : "pending",
      detail: `${input.leadsThisWeek}/${learningTarget} leads this week.`,
    });
  }

  const fatigued = input.ads.filter((a) => a.fatigueScore >= 0.6);
  if (fatigued.length > 0) {
    triggers.push({
      id: "fatigue",
      label: "Creative fatigue",
      status: "alert",
      detail: `${fatigued.length} creative(s) may be fatiguing: ${fatigued.slice(0, 2).map((a) => a.adName).join(", ")}.`,
    });
  } else {
    triggers.push({ id: "fatigue", label: "Creative fatigue", status: "ok", detail: "No creative has crossed the diagnostic fatigue threshold." });
  }

  const gate = input.daysSinceLaunch != null ? findCurrentGate(input.daysSinceLaunch) : null;
  if (gate) {
    triggers.push({ id: "gate", label: "Decision gate", status: "pending", detail: gate.label });
  } else {
    triggers.push({
      id: "gate",
      label: "Decision gate",
      status: "pending",
      detail: input.daysSinceLaunch == null ? "Launch date is not configured." : "No decision gates are configured.",
    });
  }

  return triggers;
}

// ---------- Phase ----------
export function buildPhase(input: {
  daysSinceLaunch: number | null;
  spendCentsMTD: number | null;
  monthlyBudgetCents: number | null;
  leadsThisWeek: number | null;
}): CampaignPhase {
  const d = input.daysSinceLaunch;
  let label = "Awaiting launch date";
  let totalDays: number | null = null;

  if (d == null) {
    label = "Awaiting launch date";
  } else if (d < 7) {
    label = "Week 1 - Learning";
    totalDays = 7;
  } else if (d < 14) {
    label = "Week 2 - First lead efficiency read";
    totalDays = 14;
  } else if (d < 21) {
    label = "Week 3 - Scaling decision";
    totalDays = 21;
  } else if (d < 28) {
    label = "Week 4 - Month 2 plan";
    totalDays = 28;
  } else {
    label = `Month 2+ - Day ${d}`;
  }

  const exitCriteria: { label: string; done: boolean }[] = [];
  const learningTarget = UKTL_CONFIG.targets.learningLeadsPerWeek;
  exitCriteria.push({
    label: learningTarget == null ? "Learning lead target not set" : `${learningTarget} leads/week`,
    done: learningTarget != null && input.leadsThisWeek != null && input.leadsThisWeek >= learningTarget,
  });
  exitCriteria.push({
    label: input.monthlyBudgetCents == null ? "Monthly budget target not set" : "Monthly budget target configured",
    done: input.monthlyBudgetCents != null,
  });
  if (d != null && totalDays != null) {
    exitCriteria.push({
      label: `${totalDays} days elapsed`,
      done: d >= totalDays,
    });
  }

  return {
    label,
    daysIn: d,
    totalDays,
    spendPaceCents: input.spendCentsMTD,
    spendPaceBudgetCents: input.monthlyBudgetCents,
    exitCriteria,
  };
}
