import type { UKTLConfig } from "@/lib/uktl-config";
import {
  COMPARISON_WINDOWS,
  RECOMMENDATION_RULE_VERSION,
  type ComparisonWindow,
  type RecommendationAnalysis,
  type RecommendationCandidate,
  type RecommendationConfidence,
  type RecommendationEvidence,
  type RecommendationMetricDeltas,
  type RecommendationMetrics,
  type RecommendationSeriesPoint,
  type RecommendationSeverity,
  type RecommendationSignal,
  type RecommendationSignalStatus,
  type RecommendationTarget,
  type RecommendationType,
} from "@/lib/recommendation-types";

export type RecommendationMetricTotals = {
  spendCents: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  leads: number | null;
  frequency: number | null;
};

export type RecommendationAnalysisInput = {
  config: UKTLConfig;
  target: RecommendationTarget;
  comparisonDays: ComparisonWindow;
  ranges?: {
    current: { since: string; until: string } | null;
    previous: { since: string; until: string } | null;
    cumulative: { since: string; until: string } | null;
  };
  current: RecommendationMetrics;
  previous: RecommendationMetrics | null;
  cumulative: RecommendationMetrics | null;
  status: string | null;
  learningState: string | null;
  series: readonly RecommendationSeriesPoint[];
  sampleSize: number;
  daysActive: number | null;
  budgetCents?: number | null;
};

const CHANGE_THRESHOLD_PCT = 20;
const ANOMALY_THRESHOLD_PCT = 30;
const MIN_SERIES_POINTS_FOR_ANOMALY = 3;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeOrNull(value: number | null | undefined): number | null {
  const normalised = finiteOrNull(value);
  return normalised == null || normalised < 0 ? null : normalised;
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return (numerator / denominator) * multiplier;
}

/**
 * Derive all ratios from numerators. Callers should use this for each matched
 * window rather than averaging daily CPL, CPM or CTR values.
 */
export function metricsFromTotals(totals: RecommendationMetricTotals): RecommendationMetrics {
  const spendCents = nonNegativeOrNull(totals.spendCents);
  const impressions = nonNegativeOrNull(totals.impressions);
  const reach = nonNegativeOrNull(totals.reach);
  const clicks = nonNegativeOrNull(totals.clicks);
  const linkClicks = nonNegativeOrNull(totals.linkClicks);
  const leads = nonNegativeOrNull(totals.leads);
  const frequency = nonNegativeOrNull(totals.frequency);
  return {
    spendCents,
    impressions,
    reach,
    clicks,
    linkClicks,
    leads,
    frequency,
    cplCents: ratio(spendCents, leads),
    cpmCents: ratio(spendCents, impressions, 1_000),
    cpcCents: ratio(spendCents, clicks),
    ctrLink: ratio(linkClicks, impressions),
  };
}

function emptyMetrics(): RecommendationMetrics {
  return metricsFromTotals({
    spendCents: null,
    impressions: null,
    reach: null,
    clicks: null,
    linkClicks: null,
    leads: null,
    frequency: null,
  });
}

export function metricsFromBucket(bucket: {
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  frequency: number | null;
}): RecommendationMetrics {
  return metricsFromTotals({
    spendCents: bucket.spendCents,
    impressions: bucket.impressions,
    reach: null,
    clicks: null,
    linkClicks: bucket.linkClicks,
    leads: bucket.leads,
    frequency: bucket.frequency,
  });
}

function canonicalMetrics(metrics: RecommendationMetrics | null): RecommendationMetrics | null {
  if (!metrics) return null;
  return metricsFromTotals(metrics);
}

function pctChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function hasActivity(metrics: RecommendationMetrics): boolean {
  return [metrics.spendCents, metrics.impressions, metrics.linkClicks]
    .some((value) => value != null && value > 0);
}

function hasSufficientEvidence(metrics: RecommendationMetrics, config: UKTLConfig): boolean {
  if (metrics.spendCents == null || metrics.impressions == null || metrics.leads == null) return false;
  if (metrics.impressions < config.evidence.minImpressionsForRate) return false;
  if (metrics.leads < config.evidence.minLeadsForVerdict) return false;
  return config.evidence.minSpendMinorUnits == null || metrics.spendCents >= config.evidence.minSpendMinorUnits;
}

function isPaused(status: string | null): boolean {
  return typeof status === "string" && /paused|deleted|archived/i.test(status);
}

function isLearning(learningState: string | null): boolean {
  return typeof learningState === "string" && /learning|prepar|limited/i.test(learningState);
}

function expectedSpendCents(config: UKTLConfig, budgetCents: number | null | undefined, daysActive: number | null): number | null {
  // `undefined` falls back to the account-level budget; `null` explicitly
  // means that this target has no known budget of its own.
  const budget = budgetCents === null ? null : budgetCents ?? config.targets.monthlyBudgetMinorUnits;
  if (budget == null || budget <= 0 || daysActive == null || daysActive <= 0) return null;
  return Math.round(budget * Math.min(daysActive, 30) / 30);
}

function evidenceFor(input: {
  config: UKTLConfig;
  comparisonDays: ComparisonWindow;
  ranges?: RecommendationAnalysisInput["ranges"];
  current: RecommendationMetrics;
  previous: RecommendationMetrics | null;
  cumulative: RecommendationMetrics | null;
  status: string | null;
  learningState: string | null;
  series: readonly RecommendationSeriesPoint[];
  sampleSize: number;
  daysActive: number | null;
  budgetCents: number | null | undefined;
  confidenceScore: number;
  confidenceFactors: RecommendationEvidence["confidenceFactors"];
}): RecommendationEvidence {
  const { config, comparisonDays, current, previous, cumulative, status, learningState, series, sampleSize, daysActive, budgetCents, confidenceScore, confidenceFactors } = input;
  const deltas: RecommendationMetricDeltas = {
    spendPct: pctChange(current.spendCents, previous?.spendCents ?? null),
    leadsPct: pctChange(current.leads, previous?.leads ?? null),
    cplPct: pctChange(current.cplCents, previous?.cplCents ?? null),
    ctrPct: pctChange(current.ctrLink, previous?.ctrLink ?? null),
    frequencyPct: pctChange(current.frequency, previous?.frequency ?? null),
  };
  const effectiveBudget = budgetCents === null ? null : budgetCents ?? config.targets.monthlyBudgetMinorUnits;
  return {
    evidenceVersion: 1,
    ruleVersion: RECOMMENDATION_RULE_VERSION,
    comparisonDays,
    ranges: input.ranges ?? { current: null, previous: null, cumulative: null },
    sampleSize: Math.max(0, Math.trunc(sampleSize)),
    seriesPoints: series.length,
    daysActive,
    confidenceScore,
    confidenceFactors,
    status,
    learningState,
    current,
    previous,
    cumulative,
    series: [...series],
    deltas,
    thresholds: {
      minLeads: config.evidence.minLeadsForVerdict,
      minImpressions: config.evidence.minImpressionsForRate,
      minSpendCents: config.evidence.minSpendMinorUnits,
      cplTargetCents: config.targets.cpl.targetMinorUnits,
      cplAcceptableCents: config.targets.cpl.acceptableMinorUnits,
      cplMaximumCents: config.targets.cpl.maximumMinorUnits,
      frequencyWatch: config.frequency.watchAbove,
      frequencyAlert: config.frequency.alertAbove,
      expectedSpendCents: expectedSpendCents(config, budgetCents, daysActive),
      budgetCents: effectiveBudget,
    },
    notes: [],
  };
}

function baseConfidence(input: {
  config: UKTLConfig;
  current: RecommendationMetrics;
  previous: RecommendationMetrics | null;
  series: readonly RecommendationSeriesPoint[];
  sampleSize: number;
  daysActive: number | null;
}): {
  band: RecommendationConfidence;
  score: number;
  factors: RecommendationEvidence["confidenceFactors"];
} {
  const factors = {
    currentSpendImpressionsComplete: input.current.spendCents != null && input.current.impressions != null,
    currentLeadsKnown: input.current.leads != null,
    currentEvidenceSufficient: hasSufficientEvidence(input.current, input.config),
    previousEvidenceSufficient: input.previous != null && hasSufficientEvidence(input.previous, input.config),
    sampleSizeSufficient: input.sampleSize >= MIN_SERIES_POINTS_FOR_ANOMALY,
    seriesSufficient: input.series.length >= MIN_SERIES_POINTS_FOR_ANOMALY,
    daysActiveSufficient: input.daysActive != null && input.daysActive >= 7,
  };
  let points = 0;
  if (factors.currentSpendImpressionsComplete) points += 1;
  if (factors.currentLeadsKnown) points += 1;
  if (factors.currentEvidenceSufficient) points += 2;
  if (factors.previousEvidenceSufficient) points += 1;
  if (factors.sampleSizeSufficient) points += 1;
  if (factors.seriesSufficient) points += 1;
  if (factors.daysActiveSufficient) points += 1;
  const score = Math.round(points / 8 * 100);
  return {
    band: score >= 75 ? "high" : score >= 38 ? "medium" : "low",
    score,
    factors,
  };
}

function signal(input: {
  id: string;
  status: RecommendationSignalStatus;
  confidence: RecommendationConfidence;
  reason: string;
  evidence: RecommendationEvidence;
}): RecommendationSignal {
  return input;
}

function candidate(input: {
  type: RecommendationType;
  target: RecommendationTarget;
  severity: RecommendationSeverity;
  confidence: RecommendationConfidence;
  reason: string;
  evidence: RecommendationEvidence;
  proposedAction: string;
  signals: RecommendationSignal[];
}): RecommendationCandidate {
  return {
    key: `${input.target.type}:${input.target.id}:${input.type}:${input.evidence.comparisonDays}d:${RECOMMENDATION_RULE_VERSION}`,
    ...input,
  };
}

function addRecommendation(
  recommendations: RecommendationCandidate[],
  value: Omit<RecommendationCandidate, "key">,
): void {
  if (recommendations.some((item) => item.type === value.type)) return;
  recommendations.push(candidate(value));
}

function validComparisonWindow(value: number): value is ComparisonWindow {
  return (COMPARISON_WINDOWS as readonly number[]).includes(value);
}

export function isValidComparisonWindow(value: number): value is ComparisonWindow {
  return validComparisonWindow(value);
}

function stableNumber(value: number | null): number | null {
  return value == null ? null : Number(value.toFixed(6));
}

/**
 * Analyse one account, campaign, ad set or ad. The function is deliberately
 * pure: no dates, randomness, provider calls or hidden defaults enter the
 * result. All action candidates carry the same numeric evidence object.
 */
export function analyseRecommendations(input: RecommendationAnalysisInput): RecommendationAnalysis {
  if (!validComparisonWindow(input.comparisonDays)) {
    throw new Error("Unsupported recommendation comparison window");
  }

  const config = input.config;
  const current = canonicalMetrics(input.current) ?? emptyMetrics();
  const previous = canonicalMetrics(input.previous);
  const cumulative = canonicalMetrics(input.cumulative);
  const series = input.series.map((point) => ({ ...point, metrics: canonicalMetrics(point.metrics) ?? emptyMetrics() }));
  const confidenceAssessment = baseConfidence({
    config,
    current,
    previous,
    series,
    sampleSize: input.sampleSize,
    daysActive: input.daysActive,
  });
  const evidence = evidenceFor({
    config,
    comparisonDays: input.comparisonDays,
    ranges: input.ranges,
    current,
    previous,
    cumulative,
    status: input.status,
    learningState: input.learningState,
    series,
    sampleSize: input.sampleSize,
    daysActive: input.daysActive,
    budgetCents: input.budgetCents,
    confidenceScore: confidenceAssessment.score,
    confidenceFactors: confidenceAssessment.factors,
  });
  const confidence = confidenceAssessment.band;
  const recommendations: RecommendationCandidate[] = [];
  const signals: RecommendationSignal[] = [];
  const currentSufficient = hasSufficientEvidence(current, config);
  const previousSufficient = previous != null && hasSufficientEvidence(previous, config);
  const activity = hasActivity(current);
  const currentLeadsMissing = activity && current.leads == null;
  const previousHadLeads = previous?.leads != null && previous.leads > 0;
  const cplChange = evidence.deltas.cplPct;
  const ctrChange = evidence.deltas.ctrPct;
  const leadsChange = evidence.deltas.leadsPct;
  const frequencyChange = evidence.deltas.frequencyPct;
  const frequencyDeterioration = current.frequency != null
    && current.frequency >= config.frequency.watchAbove
    && frequencyChange != null
    && frequencyChange >= CHANGE_THRESHOLD_PCT;
  const ctrDeterioration = ctrChange != null && ctrChange <= -CHANGE_THRESHOLD_PCT;
  const cplDeterioration = cplChange != null && cplChange >= CHANGE_THRESHOLD_PCT;
  const leadsDeterioration = leadsChange != null && leadsChange <= -CHANGE_THRESHOLD_PCT;
  const fatigueEligible = input.target.type === "ad";
  const combinedFatigue = currentSufficient
    && previousSufficient
    && fatigueEligible
    && (input.daysActive == null || input.daysActive >= 7)
    && frequencyDeterioration
    && [ctrDeterioration, cplDeterioration, leadsDeterioration].filter(Boolean).length >= 1;
  const learning = isLearning(input.learningState);
  const paused = isPaused(input.status);
  const isNew = input.daysActive != null && input.daysActive < 7;
  const fatigueEvidenceAvailable = currentSufficient
    && previousSufficient
    && current.frequency != null
    && previous?.frequency != null;
  const expectedSpend = evidence.thresholds.expectedSpendCents;
  const cumulativeSpend = cumulative?.spendCents ?? null;
  const budgetPct = pctChange(cumulativeSpend, expectedSpend);
  const budgetWatch = expectedSpend != null
    && cumulativeSpend != null
    && ((budgetPct != null && budgetPct >= CHANGE_THRESHOLD_PCT)
      || (input.daysActive != null && input.daysActive >= 7 && budgetPct != null && budgetPct <= -50));

  const evidenceStatus: RecommendationSignalStatus = !activity
    ? "unknown"
    : currentLeadsMissing
      ? "unknown"
      : currentSufficient
        ? "clear"
        : "watch";
  const evidenceReason = !activity
    ? "No stored spend, impressions or link-click activity is available for this window."
    : currentLeadsMissing
      ? "Activity is present but the lead result is unavailable; a performance verdict would be unsafe."
      : currentSufficient
        ? "Stored spend, impression and lead totals clear the configured evidence thresholds."
        : `Stored evidence is below the configured minimum of ${config.evidence.minLeadsForVerdict} leads and ${config.evidence.minImpressionsForRate.toLocaleString("en-GB")} impressions.`;
  const evidenceSignal = signal({
    id: "evidence",
    status: evidenceStatus,
    confidence,
    reason: evidenceReason,
    evidence,
  });
  signals.push(evidenceSignal);

  const comparisonAvailable = previous != null && previousSufficient;
  const trendStatus: RecommendationSignalStatus = !comparisonAvailable
    ? "unknown"
    : cplDeterioration || leadsDeterioration
      ? "triggered"
      : cplChange != null && cplChange <= -CHANGE_THRESHOLD_PCT
        ? "clear"
        : "watch";
  const trendReason = !comparisonAvailable
    ? "A matched historical baseline with sufficient evidence is not available."
    : cplDeterioration
      ? `CPL is ${Math.round(Math.abs(cplChange ?? 0))}% higher than the matched ${input.comparisonDays}d baseline.`
      : leadsDeterioration
        ? `Leads are ${Math.round(Math.abs(leadsChange ?? 0))}% lower than the matched ${input.comparisonDays}d baseline.`
        : cplChange != null && cplChange <= -CHANGE_THRESHOLD_PCT
          ? `CPL is ${Math.round(Math.abs(cplChange))}% lower than the matched ${input.comparisonDays}d baseline.`
          : "No material deterioration is evidenced against the matched baseline.";
  const trendSignal = signal({
    id: "matched-trend",
    status: trendStatus,
    confidence: comparisonAvailable ? confidence : "low",
    reason: trendReason,
    evidence,
  });
  signals.push(trendSignal);

  const anomalySeries = series.filter((point) => point.metrics.spendCents != null || point.metrics.impressions != null);
  const anomalyEligible = input.sampleSize >= MIN_SERIES_POINTS_FOR_ANOMALY
    && anomalySeries.length >= MIN_SERIES_POINTS_FOR_ANOMALY
    && currentSufficient
    && previousSufficient;
  const anomalyTriggered = anomalyEligible
    && [cplChange, ctrChange, frequencyChange].some((change) => change != null && Math.abs(change) >= ANOMALY_THRESHOLD_PCT);
  const anomalySignal = signal({
    id: "anomaly",
    status: anomalyTriggered ? "triggered" : anomalyEligible ? "clear" : "unknown",
    confidence: anomalyEligible ? confidence : "low",
    reason: anomalyTriggered
      ? "The matched-period change clears the anomaly threshold with enough stored daily observations."
      : anomalyEligible
        ? "No anomaly threshold is crossed in the stored daily series."
        : `Anomaly checks are withheld until ${MIN_SERIES_POINTS_FOR_ANOMALY} stored observations and sufficient rate evidence are available.`,
    evidence,
  });
  signals.push(anomalySignal);

  const fatigueSignal = signal({
    id: "fatigue",
    status: combinedFatigue ? "triggered" : fatigueEvidenceAvailable ? "clear" : "unknown",
    confidence: combinedFatigue ? confidence : fatigueEvidenceAvailable ? confidence : "low",
    reason: combinedFatigue
      ? "Frequency is rising alongside a material decline in CTR, CPL or leads; this is a combined fatigue signal."
      : fatigueEvidenceAvailable
        ? "No combined frequency-and-performance deterioration is evidenced. Frequency alone is not a fatigue verdict."
        : "Fatigue is withheld until matched windows contain sufficient stored evidence.",
    evidence,
  });
  signals.push(fatigueSignal);

  const learningSignal = signal({
    id: "learning",
    status: learning ? "watch" : paused ? "unknown" : "clear",
    confidence: learning || paused ? "medium" : confidence,
    reason: learning
      ? `Meta reports learning state ${input.learningState}; avoid treating early performance as settled.`
      : paused
        ? `Meta reports status ${input.status}; no active delivery change is inferred.`
        : "No learning-state constraint is present in the supplied metadata.",
    evidence,
  });
  signals.push(learningSignal);

  const budgetSignal = signal({
    id: "budget",
    status: budgetWatch ? "triggered" : expectedSpend != null && cumulativeSpend != null ? "clear" : "unknown",
    confidence: budgetWatch ? confidence : expectedSpend != null && cumulativeSpend != null ? "medium" : "low",
    reason: budgetWatch
      ? `Cumulative stored spend is ${Math.round(Math.abs(budgetPct ?? 0))}% ${budgetPct != null && budgetPct >= 0 ? "above" : "below"} the expected pace.`
      : expectedSpend != null && cumulativeSpend != null
        ? "Cumulative stored spend is within the configured pace band."
        : "Budget pace is unavailable because no positive budget and elapsed-day basis are supplied.",
    evidence,
  });
  signals.push(budgetSignal);

  if (currentLeadsMissing || (activity && current.leads === 0 && previousHadLeads)) {
    addRecommendation(recommendations, {
      type: "possible_tracking_issue",
      target: input.target,
      severity: previousHadLeads ? "alert" : "watch",
      confidence: previousHadLeads && previousSufficient ? "high" : confidence,
      reason: currentLeadsMissing
        ? "Meta activity is stored but the configured lead result is missing, so performance cannot be judged safely."
        : "The matched baseline contained leads, but the current active period contains none while delivery continues.",
      evidence,
      proposedAction: "Check the lead event, form path and recent tracking changes before changing the ad.",
      signals: [evidenceSignal, trendSignal],
    });
  } else if (combinedFatigue) {
    addRecommendation(recommendations, {
      type: "creative_refresh",
      target: input.target,
      severity: "alert",
      confidence,
      reason: "Frequency is rising while engagement or lead efficiency is deteriorating in the matched windows.",
      evidence,
      proposedAction: "Review the current creative angle and prepare a fresh variant; keep the change approval-gated.",
      signals: [fatigueSignal, trendSignal],
    });
  } else if (currentSufficient
    && !learning
    && !paused
    && !isNew
    && config.targets.cpl.maximumMinorUnits != null
    && current.cplCents != null
    && current.cplCents > config.targets.cpl.maximumMinorUnits) {
    addRecommendation(recommendations, {
      type: "pause_candidate",
      target: input.target,
      severity: "alert",
      confidence,
      reason: `CPL is ${Math.round(current.cplCents)} cents above the configured maximum of ${config.targets.cpl.maximumMinorUnits} cents with sufficient evidence.`,
      evidence,
      proposedAction: "Review lead quality and the landing path, then consider pausing only after human approval.",
      signals: [evidenceSignal, trendSignal],
    });
  } else if (currentSufficient
    && !learning
    && !paused
    && !isNew
    && previousSufficient
    && config.targets.cpl.targetMinorUnits != null
    && current.cplCents != null
    && current.cplCents <= config.targets.cpl.targetMinorUnits
    && !cplDeterioration
    && !leadsDeterioration) {
    addRecommendation(recommendations, {
      type: "scale_candidate",
      target: input.target,
      severity: "info",
      confidence,
      reason: `CPL is within the configured target of ${config.targets.cpl.targetMinorUnits} cents with sufficient stored lead evidence.`,
      evidence,
      proposedAction: "Review lead quality and capacity, then consider a measured budget increase only with human approval.",
      signals: [evidenceSignal, trendSignal, learningSignal],
    });
  } else if (!activity || !currentSufficient || learning || isNew) {
    addRecommendation(recommendations, {
      type: "monitor",
      target: input.target,
      severity: "watch",
      confidence: currentSufficient ? confidence : "low",
      reason: !activity
        ? "No delivery evidence is stored, so there is nothing safe to optimise yet."
        : learning
          ? "The entity is still in learning; wait for more evidence before drawing a performance conclusion."
          : isNew
            ? "The entity is new; collect a matched period before making a conclusive change."
            : evidenceReason,
      evidence,
      proposedAction: "Keep the entity under observation and wait for a comparable evidence window.",
      signals: [evidenceSignal, learningSignal],
    });
  } else if (paused) {
    addRecommendation(recommendations, {
      type: "hold",
      target: input.target,
      severity: "info",
      confidence: "medium",
      reason: "The entity is paused or archived; no active delivery change is inferred from stored performance.",
      evidence,
      proposedAction: "Hold the current state until a human reviews whether reactivation is appropriate.",
      signals: [learningSignal, evidenceSignal],
    });
  } else if (cplDeterioration || leadsDeterioration || (anomalyTriggered && trendStatus === "triggered")) {
    addRecommendation(recommendations, {
      type: "monitor",
      target: input.target,
      severity: "watch",
      confidence,
      reason: "The matched trend has deteriorated, but the evidence does not meet the rules for an automated action candidate.",
      evidence,
      proposedAction: "Inspect the creative, lead path and lead quality before deciding whether to change delivery.",
      signals: [trendSignal, anomalySignal],
    });
  } else {
    addRecommendation(recommendations, {
      type: "hold",
      target: input.target,
      severity: "info",
      confidence: currentSufficient ? confidence : "low",
      reason: currentSufficient
        ? "Stored evidence does not identify a higher-priority issue or action candidate."
        : "There is not enough stored evidence for a conclusive change.",
      evidence,
      proposedAction: "Hold the current state and continue collecting matched evidence.",
      signals: [evidenceSignal, trendSignal],
    });
  }

  if (budgetWatch) {
    addRecommendation(recommendations, {
      type: "budget_watch",
      target: input.target,
      severity: budgetPct != null && budgetPct >= CHANGE_THRESHOLD_PCT ? "alert" : "watch",
      confidence,
      reason: budgetPct != null && budgetPct >= CHANGE_THRESHOLD_PCT
        ? "Stored cumulative spend is materially ahead of the configured budget pace."
        : "Stored cumulative spend is materially behind the configured budget pace.",
      evidence,
      proposedAction: "Check the configured budget and delivery settings before changing spend; do not infer a new budget.",
      signals: [budgetSignal],
    });
  }

  // Keep evidence compact and stable when persisted. This also guards against
  // floating-point noise changing the displayed reason on repeated runs.
  for (const item of [evidence.current, evidence.previous, evidence.cumulative]) {
    if (!item) continue;
    item.cplCents = stableNumber(item.cplCents);
    item.cpmCents = stableNumber(item.cpmCents);
    item.cpcCents = stableNumber(item.cpcCents);
    item.ctrLink = stableNumber(item.ctrLink);
    item.frequency = stableNumber(item.frequency);
  }

  return { signals, recommendations };
}

// Keep the American spelling available to callers while the implementation
// uses the UK spelling used throughout the product copy.
export const analyzeRecommendations = analyseRecommendations;
