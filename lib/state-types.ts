// Shape returned by /api/dashboard/state. Keep in sync with route.ts.
import type { UKTLConfig } from "./uktl-config";

export type Bucket = {
  // Values are nullable because Meta may omit a field or no stored row may
  // exist for the requested period. A real zero is kept as 0.
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  cplCents: number | null;
  ctrLink: number | null;
  cpmCents: number | null;
  frequency: number | null;
};

export type AdVerdictTag = "too_early" | "winner" | "performing" | "watch" | "cull" | "unknown";

export type AdRow = {
  adId: string;
  adName: string;
  status: string;
  thumbnailUrl: string | null;
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

export type TrendPoint = {
  date: string;
  spendCents: number | null;
  impressions: number | null;
  linkClicks: number | null;
  leads: number | null;
  cplCents: number | null;
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

export type Anomaly = {
  metric: "cpl" | "cpm" | "ctr" | "spend" | "leads";
  direction: "up" | "down";
  changePct: number;
  date: string;
  message: string;
  severity: "info" | "warn" | "alert";
};

export type ActionLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetId: string;
  reasoning: string;
  executor: string;
  result?: string | null;
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

export type DashboardState = {
  meta: {
    adAccountId: string | null;
    campaignId: string | null;
    launchDate: string | null;
    daysSinceLaunch: number | null;
    currencyCode: string | null;
    timezoneName: string | null;
    lastSyncAt: string | null;
    lastSyncAgeMs: number | null;
    lastSuccessfulSyncAt: string | null;
    lastAttemptAt: string | null;
    lastAttemptStatus: string | null;
    lastSyncError: string | null;
    syncState: "never" | "running" | "fresh" | "stale" | "failed";
  };
  scorecard: {
    today: Bucket;
    yesterday: Bucket;
    mtd: Bucket;
    last7: Bucket;
    previous7: Bucket;
    last14: Bucket;
    previous14: Bucket;
    last30: Bucket;
    previous30: Bucket;
    leadsThisWeek: number | null;
    learningProgress: number | null;
    learningLeadsTarget: number | null;
    budget: { dailyCents: number | null; monthlyCents: number | null };
  };
  trend: TrendPoint[];
  heatmap: HeatmapCell[];
  ads: AdRow[];
  funnel: FunnelData;
  anomalies: Anomaly[];
  actionLog: ActionLogEntry[];
  phase: CampaignPhase;
  triggers: DecisionTrigger[];
  targets: UKTLConfig;
};
