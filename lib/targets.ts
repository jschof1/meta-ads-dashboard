import { UKTL_CONFIG, type MoneyTarget } from "./uktl-config";

export { UKTL_CONFIG } from "./uktl-config";
export type { UKTLConfig, UKTLTargets, FunnelStage, FunnelStageKey, MoneyTarget, RateTarget, DecisionGate } from "./uktl-config";

export type MetricBandStatus = "green" | "yellow" | "red" | "unknown";

export function classifyCpl(cplCents: number | null): MetricBandStatus {
  if (cplCents == null || cplCents <= 0) return "unknown";
  const target = UKTL_CONFIG.targets.cpl;
  if (target.targetMinorUnits != null && cplCents <= target.targetMinorUnits) return "green";
  if (target.acceptableMinorUnits != null && cplCents <= target.acceptableMinorUnits) return "yellow";
  if (target.maximumMinorUnits != null) return "red";
  return "unknown";
}

export function findCurrentGate(daysSinceLaunch: number) {
  let current = null;
  for (const gate of UKTL_CONFIG.targets.decisionGates) {
    if (daysSinceLaunch >= gate.day) current = gate;
  }
  return current;
}

export type AdVerdict = "too_early" | "winner" | "performing" | "watch" | "cull" | "unknown";

function enoughEvidence(spendCents: number | null, leads: number | null): boolean {
  const minimumSpend = UKTL_CONFIG.evidence.minSpendMinorUnits;
  return spendCents != null
    && leads != null
    && leads >= UKTL_CONFIG.evidence.minLeadsForVerdict
    && (minimumSpend == null || spendCents >= minimumSpend);
}

export function classifyAd(input: {
  spendCents: number | null;
  leads: number | null;
  cplCents: number | null;
  ctrLink: number | null;
}): { verdict: AdVerdict; reason: string } {
  const { spendCents, leads, cplCents, ctrLink } = input;
  if (!enoughEvidence(spendCents, leads)) {
    return {
      verdict: "too_early",
      reason: `Too early - need ${UKTL_CONFIG.evidence.minLeadsForVerdict}+ stored leads before comparing ads.`,
    };
  }
  if (cplCents == null) {
    return { verdict: "unknown", reason: "CPL is unavailable; lead count cannot establish cost." };
  }

  const target: MoneyTarget = UKTL_CONFIG.targets.cpl;
  if (target.maximumMinorUnits != null && cplCents > target.maximumMinorUnits) {
    return { verdict: "cull", reason: "CPL is above the configured maximum; review the ad before further spend." };
  }
  if (target.acceptableMinorUnits != null && cplCents > target.acceptableMinorUnits) {
    return { verdict: "watch", reason: "CPL is above the configured acceptable range; compare lead quality and trend." };
  }
  if (target.targetMinorUnits != null && cplCents <= target.targetMinorUnits) {
    return {
      verdict: "winner",
      reason: ctrLink == null
        ? "CPL is inside the configured target; link CTR is unavailable."
        : "CPL is inside the configured target; review link CTR alongside lead quality.",
    };
  }
  if (target.acceptableMinorUnits != null && cplCents <= target.acceptableMinorUnits) {
    return { verdict: "performing", reason: "CPL is inside the configured acceptable range." };
  }
  return { verdict: "unknown", reason: "No CPL target is configured; compare this ad with its historical baseline." };
}
