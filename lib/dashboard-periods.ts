import type { DashboardPeriod, PeriodBuckets } from "@/lib/state-types";

export type PeriodDefinition = {
  label: string;
  current: keyof PeriodBuckets;
  comparison: keyof PeriodBuckets;
  comparisonLabel: string;
};

export const DASHBOARD_PERIODS: readonly DashboardPeriod[] = ["today", "7d", "14d", "30d", "mtd"];

export const PERIOD_DEFINITIONS: Record<DashboardPeriod, PeriodDefinition> = {
  today: { label: "Today", current: "today", comparison: "yesterday", comparisonLabel: "yesterday" },
  "7d": { label: "7d", current: "last7", comparison: "previous7", comparisonLabel: "previous matched 7d" },
  "14d": { label: "14d", current: "last14", comparison: "previous14", comparisonLabel: "previous matched 14d" },
  "30d": { label: "30d", current: "last30", comparison: "previous30", comparisonLabel: "previous matched 30d" },
  mtd: { label: "MTD", current: "mtd", comparison: "previousMtd", comparisonLabel: "same elapsed days last month" },
};

export function periodDefinition(period: DashboardPeriod): PeriodDefinition {
  return PERIOD_DEFINITIONS[period];
}

export function comparisonIsComparable(period: DashboardPeriod, mtdComparisonComparable = true): boolean {
  return period !== "mtd" || mtdComparisonComparable;
}

export function comparisonLabel(period: DashboardPeriod, mtdComparisonComparable = true): string {
  if (period === "mtd" && !mtdComparisonComparable) return "no matched baseline (shorter prior month)";
  return periodDefinition(period).comparisonLabel;
}

export function comparisonInstruction(period: DashboardPeriod, mtdComparisonComparable = true): string {
  if (!comparisonIsComparable(period, mtdComparisonComparable)) {
    return "MTD changes are withheld because the prior month ended before the current elapsed day.";
  }
  return `each change compares with ${comparisonLabel(period, mtdComparisonComparable)}.`;
}

export function currentBucket(periods: PeriodBuckets, period: DashboardPeriod) {
  return periods[periodDefinition(period).current];
}

export function comparisonBucket(periods: PeriodBuckets, period: DashboardPeriod) {
  return periods[periodDefinition(period).comparison];
}
