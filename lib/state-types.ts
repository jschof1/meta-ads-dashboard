// Shape returned by /api/dashboard/state. Keep in sync with route.ts.
import type { UKTLConfig } from "./uktl-config";
import type {
  RecommendationConfidence,
  RecommendationEvidence,
  RecommendationLifecycle,
  RecommendationSeverity,
  RecommendationTargetType,
  RecommendationType,
} from "./recommendation-types";
import type { MetaActionGate, MetaActionView } from "./meta-action-types";

export type Bucket = {
  // Values are nullable because Meta may omit a field or no stored row may
  // exist for the requested period. A real zero is kept as 0.
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  cplCents: number | null;
  cpcCents: number | null;
  ctrLink: number | null;
  cpmCents: number | null;
  // For multi-day windows this is the impression-weighted average of the
  // stored daily Meta frequencies; it is not de-duplicated cross-day reach.
  frequency: number | null;
};

export type DashboardPeriod = "today" | "7d" | "14d" | "30d" | "mtd";

export type PeriodBuckets = {
  today: Bucket;
  yesterday: Bucket;
  mtd: Bucket;
  previousMtd: Bucket;
  last7: Bucket;
  previous7: Bucket;
  last14: Bucket;
  previous14: Bucket;
  last30: Bucket;
  previous30: Bucket;
};

export type EvidenceStatus = "unknown" | "thin" | "sufficient";

export type EntityEvidence = {
  status: EvidenceStatus;
  reason: string;
};

export type AdVerdictTag = "too_early" | "winner" | "performing" | "watch" | "cull" | "unknown";

export type AdRow = {
  adId: string;
  adName: string;
  status: string;
  isCurrent: boolean;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  creativeId: string | null;
  format: string | null;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
  imageHash: string | null;
  objectId: string | null;
  urlTags: string | null;
  lastChangeAt: string | null;
  campaignId: string | null;
  adSetId: string | null;
  periods: PeriodBuckets;
  evidence: Record<DashboardPeriod, EntityEvidence>;
  evidenceStatus: EvidenceStatus;
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  ctrLink: number | null;
  leads: number | null;
  cplCents: number | null;
  frequency: number | null;
  verdict: AdVerdictTag;
  verdictReason: string;
  firstSeenDate: string | null;
  daysActive: number | null;
  fatigueScore: number;       // 0 (fresh) .. 1 (dying)
  fatigueReason: string;
};

export type CampaignRow = {
  campaignId: string;
  campaignName: string;
  objective: string | null;
  status: string;
  isCurrent: boolean;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  startDate: string | null;
  stopDate: string | null;
  periods: PeriodBuckets;
  evidence: Record<DashboardPeriod, EntityEvidence>;
  evidenceStatus: EvidenceStatus;
};

export type AdSetRow = {
  adSetId: string;
  campaignId: string | null;
  adSetName: string;
  status: string;
  isCurrent: boolean;
  learningStage: string | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  startDate: string | null;
  endDate: string | null;
  periods: PeriodBuckets;
  evidence: Record<DashboardPeriod, EntityEvidence>;
  evidenceStatus: EvidenceStatus;
};

export type TrendPoint = {
  date: string;
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  cplCents: number | null;
  cpcCents: number | null;
  cpmCents: number | null;
  ctrLink: number | null;
  frequency: number | null;
};

export type HeatmapCell = {
  date: string;          // YYYY-MM-DD
  intensity: number;     // 0..1
  spendCents: number | null;
  leads: number | null;
  cplCents: number | null;
};

export type FunnelData = {
  metaPixelImpressions: number | null;
  metaPixelLinkClicks: number | null;
  leads: number | null;
  contacted: number | null;
  qualified: number | null;
  callsBooked: number | null;
  callsAttended: number | null;
  wonCustomers: number | null;
  lostCustomers: number | null;
  metaPixelLeads: number | null;
  testEmailsExcluded: number;
  duplicatesCollapsed: number;
  crmConfigured: boolean;
};

export type CrmStatus = "not_configured" | "disabled" | "misconfigured" | "never" | "running" | "fresh" | "stale" | "failed";
export type CrmDataQuality = "complete" | "partial" | "unknown";
export type CrmAttributionGranularity = "ad" | "campaign" | "paid-meta" | "unattributed";
export type CrmRevenueStatus = "complete" | "incomplete" | "unknown";

export type CrmCounts = {
  /** Distinct HighLevel contacts in the 30-day contact-created cohort. */
  crmRecords: number | null;
  /** Contacts with an explicit ad, campaign or paid-Meta attribution. */
  attributedRecords: number | null;
  /** All contacts classified as paid Meta, including explicit id matches. */
  paidMetaRecords: number | null;
  /** Meta-reported lead results; deliberately kept separate from CRM contacts. */
  metaLeads: number | null;
  contacted: number | null;
  qualified: number | null;
  callsBooked: number | null;
  callsAttended: number | null;
  wonCustomers: number | null;
  lostCustomers: number | null;
};

export type CrmRates = {
  leadToContacted: number | null;
  contactedToQualified: number | null;
  qualifiedToBooked: number | null;
  bookedToAttended: number | null;
  attendedToWon: number | null;
  showRate: number | null;
  closeRate: number | null;
};

export type CrmCosts = {
  qualifiedLeadCostMinorUnits: number | null;
  bookedCallCostMinorUnits: number | null;
  customerCacMinorUnits: number | null;
};

export type CrmRevenue = {
  minorUnits: number | null;
  currencyCode: string | null;
  status: CrmRevenueStatus;
  roas: number | null;
};

export type CrmAttributionBreakdown = {
  granularity: CrmAttributionGranularity;
  records: number | null;
  contacted: number | null;
  qualified: number | null;
  callsBooked: number | null;
  callsAttended: number | null;
  wonCustomers: number | null;
  lostCustomers: number | null;
  attributedRevenueMinorUnits: number | null;
  revenueStatus: CrmRevenueStatus;
};

export type CrmPerformanceByEntity = {
  granularity: "campaign" | "ad";
  id: string;
  name: string;
  metaSpendMinorUnits: number | null;
  metaLeads: number | null;
  metaCplMinorUnits: number | null;
  qualifiedLeads: number | null;
  qualifiedLeadCostMinorUnits: number | null;
  wonCustomers: number | null;
  customerCacMinorUnits: number | null;
  attributedRevenueMinorUnits: number | null;
  revenueStatus: CrmRevenueStatus;
  roas: number | null;
};

export type CrmDashboardState = {
  status: CrmStatus;
  configured: boolean;
  syncEnabled: boolean;
  locationId: string | null;
  pipelineId: string | null;
  mappingReady: boolean;
  mappingHash: string | null;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: string | null;
  lastError: string | null;
  period: { since: string; until: string; label: string };
  counts: CrmCounts;
  rates: CrmRates;
  costs: CrmCosts;
  revenue: CrmRevenue;
  attributionBreakdown: CrmAttributionBreakdown[];
  performanceByEntity: CrmPerformanceByEntity[];
  warnings: string[];
  dataQuality: CrmDataQuality;
};

export type Anomaly = {
  metric: "cpl" | "cpm" | "ctr" | "spend" | "leads";
  direction: "up" | "down";
  changePct: number;
  date: string;
  message: string;
  severity: "info" | "warn" | "alert";
};

export type DataWarning = {
  id: string;
  severity: "warn" | "alert" | "info";
  label: string;
  detail: string;
};

export type PeriodDataWarnings = Record<DashboardPeriod, DataWarning[]>;

export type ActionLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetId: string;
  reasoning: string;
  executor: string;
  result?: string | null;
};

/** Persisted, server-validated recommendation data exposed to the dashboard. */
export type RecommendationView = {
  id: string;
  fingerprint: string;
  accountId: string;
  campaignId: string | null;
  attributionKey: string;
  type: RecommendationType;
  analysisWindowDays: number;
  ruleVersion: string;
  target: {
    type: RecommendationTargetType;
    id: string;
    name: string;
  };
  severity: RecommendationSeverity;
  confidence: RecommendationConfidence;
  lifecycle: RecommendationLifecycle;
  reason: string;
  evidence: RecommendationEvidence;
  proposedAction: string;
  sourceSyncRunId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
};

export type DecisionTrigger = {
  id: string;
  label: string;
  status: "ok" | "watch" | "alert" | "pending";
  detail: string;
};

export type CampaignPhase = {
  label: string;
  daysIn: number | null;
  totalDays: number | null;
  spendPaceCents: number | null;
  spendPaceBudgetCents: number | null;
  exitCriteria: { label: string; done: boolean }[];
};

export type SpendStatus = {
  status: "unknown" | "under_pace" | "on_pace" | "over_pace" | "over_budget";
  label: string;
  detail: string;
  spendCents: number | null;
  expectedCents: number | null;
  budgetCents: number | null;
  elapsedDay: number | null;
  daysInMonth: number | null;
};

export type DashboardState = {
  meta: {
    adAccountId: string | null;
    accountName: string | null;
    campaignId: string | null;
    launchDate: string | null;
    daysSinceLaunch: number | null;
    currencyCode: string | null;
    timezoneName: string | null;
    lastSyncAt: string | null;
    lastSyncAgeMs: number | null;
    lastSuccessfulSyncAt: string | null;
    lastSuccessfulSyncRunId: string | null;
    lastAttemptAt: string | null;
    lastAttemptStatus: string | null;
    lastSyncError: string | null;
    mtdComparisonComparable: boolean;
    metadataStaleCount: number;
    syncState: "never" | "running" | "fresh" | "stale" | "failed";
    actionGate: MetaActionGate;
  };
  scorecard: PeriodBuckets & {
    leadsThisWeek: number | null;
    learningProgress: number | null;
    learningLeadsTarget: number | null;
    budget: { dailyCents: number | null; monthlyCents: number | null };
    spendStatus: SpendStatus;
  };
  trend: TrendPoint[];
  heatmap: HeatmapCell[];
  ads: AdRow[];
  campaigns: CampaignRow[];
  adSets: AdSetRow[];
  dataWarnings: PeriodDataWarnings;
  funnel: FunnelData;
  crm: CrmDashboardState;
  anomalies: Anomaly[];
  actionLog: ActionLogEntry[];
  metaActions: MetaActionView[];
  phase: CampaignPhase;
  triggers: DecisionTrigger[];
  recommendations: RecommendationView[];
  targets: UKTLConfig;
};
