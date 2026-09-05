export const RECOMMENDATION_TYPES = [
  "hold",
  "monitor",
  "possible_tracking_issue",
  "creative_refresh",
  "pause_candidate",
  "scale_candidate",
  "budget_watch",
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export const RECOMMENDATION_TARGET_TYPES = ["account", "campaign", "adset", "ad"] as const;
export type RecommendationTargetType = (typeof RECOMMENDATION_TARGET_TYPES)[number];

export const COMPARISON_WINDOWS = [3, 7, 14, 30] as const;
export type ComparisonWindow = (typeof COMPARISON_WINDOWS)[number];
export const RECOMMENDATION_RULE_VERSION = "pr06.v1";

export type RecommendationSeverity = "info" | "watch" | "alert";
export type RecommendationConfidence = "low" | "medium" | "high";
export type RecommendationSignalStatus = "clear" | "watch" | "triggered" | "unknown";

/**
 * Numerators are kept beside the derived rates so recommendation code can
 * compare matched totals without averaging daily ratios.
 */
export type RecommendationMetrics = {
  spendCents: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  leads: number | null;
  frequency: number | null;
  cplCents: number | null;
  cpmCents: number | null;
  cpcCents: number | null;
  ctrLink: number | null;
};

export type RecommendationSeriesPoint = {
  date: string;
  metrics: RecommendationMetrics;
};

export type RecommendationTarget = {
  type: RecommendationTargetType;
  id: string;
  name: string;
};

export type RecommendationMetricDeltas = {
  spendPct: number | null;
  leadsPct: number | null;
  cplPct: number | null;
  ctrPct: number | null;
  frequencyPct: number | null;
};

export type RecommendationEvidence = {
  evidenceVersion: 1;
  ruleVersion: typeof RECOMMENDATION_RULE_VERSION;
  comparisonDays: ComparisonWindow;
  ranges: {
    current: { since: string; until: string } | null;
    previous: { since: string; until: string } | null;
    cumulative: { since: string; until: string } | null;
  };
  sampleSize: number;
  seriesPoints: number;
  daysActive: number | null;
  confidenceScore: number;
  confidenceFactors: {
    currentSpendImpressionsComplete: boolean;
    currentLeadsKnown: boolean;
    currentEvidenceSufficient: boolean;
    previousEvidenceSufficient: boolean;
    sampleSizeSufficient: boolean;
    seriesSufficient: boolean;
    daysActiveSufficient: boolean;
  };
  status: string | null;
  learningState: string | null;
  current: RecommendationMetrics;
  previous: RecommendationMetrics | null;
  cumulative: RecommendationMetrics | null;
  series: RecommendationSeriesPoint[];
  deltas: RecommendationMetricDeltas;
  thresholds: {
    minLeads: number;
    minImpressions: number;
    minSpendCents: number | null;
    cplTargetCents: number | null;
    cplAcceptableCents: number | null;
    cplMaximumCents: number | null;
    frequencyWatch: number;
    frequencyAlert: number;
    expectedSpendCents: number | null;
    budgetCents: number | null;
  };
  notes: string[];
};

export type RecommendationSignal = {
  id: string;
  status: RecommendationSignalStatus;
  confidence: RecommendationConfidence;
  reason: string;
  evidence: RecommendationEvidence;
};

export type RecommendationCandidate = {
  key: string;
  type: RecommendationType;
  target: RecommendationTarget;
  severity: RecommendationSeverity;
  confidence: RecommendationConfidence;
  reason: string;
  evidence: RecommendationEvidence;
  proposedAction: string;
  signals: RecommendationSignal[];
};

export type RecommendationAnalysis = {
  signals: RecommendationSignal[];
  recommendations: RecommendationCandidate[];
};

export type RecommendationLifecycle = "OPEN" | "RESOLVED";
