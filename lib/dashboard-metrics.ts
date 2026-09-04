import { UKTL_CONFIG } from "@/lib/uktl-config";
import type { Bucket, DashboardPeriod, EntityEvidence, EvidenceStatus } from "@/lib/state-types";

export function evidenceForBucket(bucket: Bucket): EntityEvidence {
  const hasStoredActivity = bucket.spendCents != null || bucket.impressions != null || bucket.linkClicks != null;
  if (!hasStoredActivity) {
    return { status: "unknown", reason: "No stored metrics are available for this period." };
  }
  if (bucket.spendCents == null) {
    return { status: "unknown", reason: "Spend evidence is unavailable for this period." };
  }
  if (bucket.impressions == null) {
    return { status: "unknown", reason: "Impression evidence is unavailable for this period." };
  }
  if (bucket.leads == null) {
    return { status: "unknown", reason: `Lead results are unavailable; need ${UKTL_CONFIG.evidence.minLeadsForVerdict}+ stored leads before a performance verdict.` };
  }
  if (bucket.impressions < UKTL_CONFIG.evidence.minImpressionsForRate) {
    return {
      status: "thin",
      reason: `Thin sample: fewer than ${UKTL_CONFIG.evidence.minImpressionsForRate.toLocaleString("en-GB")} impressions are stored.`,
    };
  }
  if (bucket.leads < UKTL_CONFIG.evidence.minLeadsForVerdict) {
    return {
      status: "thin",
      reason: `Thin sample: fewer than ${UKTL_CONFIG.evidence.minLeadsForVerdict} stored leads are available for a verdict.`,
    };
  }
  if (UKTL_CONFIG.evidence.minSpendMinorUnits != null
    && (bucket.spendCents == null || bucket.spendCents < UKTL_CONFIG.evidence.minSpendMinorUnits)) {
    return {
      status: "thin",
      reason: "Thin sample: stored spend has not reached the configured evidence threshold.",
    };
  }
  return { status: "sufficient", reason: "Stored spend, impression and lead evidence clears the configured thresholds." };
}

export function frequencyEvidenceForBucket(bucket: Bucket): EntityEvidence {
  const overall = evidenceForBucket(bucket);
  if (overall.status === "unknown") return overall;
  if (bucket.frequency == null) {
    return {
      status: "unknown",
      reason: "Frequency is unavailable because no usable daily frequency was stored for this reporting window.",
    };
  }
  if (overall.status === "thin") {
    return {
      status: "thin",
      reason: overall.reason + " Frequency is available as a weighted daily diagnostic.",
    };
  }
  return {
    status: "sufficient",
    reason: "Frequency is available as an impression-weighted average of stored daily Meta observations.",
  };
}

export function evidenceByPeriod(periodBuckets: Pick<Record<DashboardPeriod, Bucket>, DashboardPeriod>): Record<DashboardPeriod, EntityEvidence> {
  return {
    today: evidenceForBucket(periodBuckets.today),
    "7d": evidenceForBucket(periodBuckets["7d"]),
    "14d": evidenceForBucket(periodBuckets["14d"]),
    "30d": evidenceForBucket(periodBuckets["30d"]),
    mtd: evidenceForBucket(periodBuckets.mtd),
  };
}

export function evidenceStatusForPeriod(
  periodBuckets: Pick<Record<DashboardPeriod, Bucket>, DashboardPeriod>,
  period: DashboardPeriod,
): EvidenceStatus {
  return evidenceByPeriod(periodBuckets)[period].status;
}

export function ratioDelta(current: number | null, comparison: number | null): number | null {
  if (current == null || comparison == null || comparison === 0) return null;
  return ((current - comparison) / Math.abs(comparison)) * 100;
}

export function sumBucketMetric(bucket: Bucket, metric: keyof Bucket): number | null {
  const value = bucket[metric];
  return typeof value === "number" ? value : null;
}
