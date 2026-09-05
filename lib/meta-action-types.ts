import type { RecommendationConfidence, RecommendationEvidence } from "@/lib/recommendation-types";

export const META_ACTION_KINDS = ["pause_ad", "resume_ad", "set_adset_daily_budget"] as const;
export type MetaActionKind = (typeof META_ACTION_KINDS)[number];

export const META_ACTION_STATUSES = [
  "PROPOSED",
  "APPROVED",
  "REJECTED",
  "EXECUTING",
  "EXECUTED",
  "FAILED",
] as const;
export type MetaActionStatus = (typeof META_ACTION_STATUSES)[number];

export type MetaActionTargetType = "ad" | "adset";
export type MetaAdStatus = "ACTIVE" | "PAUSED";

export type MetaActionGate = {
  writesEnabled: boolean;
  status: "disabled" | "ready" | "misconfigured";
  message: string;
};

/** The only values the service will ever send to Meta. */
export type MetaActionChange =
  | { status: MetaAdStatus }
  | { dailyBudgetMinor: number };

export type MetaActionStoredValue =
  | { status: string }
  | { dailyBudgetMinor: number };

/** Durable state captured before execution. */
export type MetaActionExpectedState = {
  status: string;
  dailyBudgetMinor: number | null;
};

export type MetaActionView = {
  id: string;
  accountId: string;
  action: MetaActionKind;
  targetType: MetaActionTargetType;
  targetId: string;
  targetName: string;
  status: MetaActionStatus;
  requestedChange: MetaActionChange;
  expectedState: MetaActionExpectedState;
  oldValue: MetaActionStoredValue | null;
  newValue: MetaActionStoredValue | null;
  reasoning: string;
  evidence: RecommendationEvidence;
  confidence: RecommendationConfidence;
  source: "operator";
  recommendationFingerprint: string | null;
  sourceSyncRunId: string | null;
  metaObjectId: string | null;
  metaTraceId: string | null;
  error: string | null;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  executingAt: string | null;
  executedAt: string | null;
  failedAt: string | null;
  updatedAt: string;
};
