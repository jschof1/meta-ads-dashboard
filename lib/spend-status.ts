import type { SpendStatus } from "@/lib/state-types";

function monthParts(localDate: string): { day: number; daysInMonth: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return { day, daysInMonth };
}

export function buildSpendStatus(input: {
  spendCents: number | null;
  budgetCents: number | null;
  localDate: string;
}): SpendStatus {
  const parts = monthParts(input.localDate);
  if (input.budgetCents == null || input.budgetCents <= 0 || parts == null) {
    return {
      status: "unknown",
      label: "Spend status unknown",
      detail: input.budgetCents == null || input.budgetCents <= 0
        ? "Set a positive monthly budget target to assess spend pace."
        : "The account-local date is unavailable, so spend pace cannot be assessed.",
      spendCents: input.spendCents,
      expectedCents: null,
      budgetCents: input.budgetCents,
      elapsedDay: parts?.day ?? null,
      daysInMonth: parts?.daysInMonth ?? null,
    };
  }
  if (input.spendCents == null) {
    return {
      status: "unknown",
      label: "Spend status unknown",
      detail: "Stored MTD spend is unavailable, so spend pace cannot be assessed.",
      spendCents: null,
      expectedCents: Math.round(input.budgetCents * parts.day / parts.daysInMonth),
      budgetCents: input.budgetCents,
      elapsedDay: parts.day,
      daysInMonth: parts.daysInMonth,
    };
  }

  const expectedCents = Math.round(input.budgetCents * parts.day / parts.daysInMonth);
  if (input.spendCents > input.budgetCents) {
    return {
      status: "over_budget",
      label: "Over monthly budget",
      detail: "MTD spend has exceeded the configured monthly budget.",
      spendCents: input.spendCents,
      expectedCents,
      budgetCents: input.budgetCents,
      elapsedDay: parts.day,
      daysInMonth: parts.daysInMonth,
    };
  }

  // A 10% band prevents tiny currency-unit differences from presenting as a
  // false pace alert while keeping the rule deterministic and explainable.
  const toleranceCents = Math.max(1, Math.round(expectedCents * 0.1));
  const status = input.spendCents < expectedCents - toleranceCents
    ? "under_pace"
    : input.spendCents > expectedCents + toleranceCents
      ? "over_pace"
      : "on_pace";
  const labels = {
    under_pace: "Under pace",
    on_pace: "On pace",
    over_pace: "Ahead of pace",
    over_budget: "Over monthly budget",
    unknown: "Spend status unknown",
  } as const;
  const details = {
    under_pace: "MTD spend is below the expected pace for the elapsed days.",
    on_pace: "MTD spend is within the expected pace for the elapsed days.",
    over_pace: "MTD spend is ahead of the expected pace for the elapsed days.",
    over_budget: "MTD spend has exceeded the configured monthly budget.",
    unknown: "Spend pace is unavailable.",
  } as const;
  return {
    status,
    label: labels[status],
    detail: details[status],
    spendCents: input.spendCents,
    expectedCents,
    budgetCents: input.budgetCents,
    elapsedDay: parts.day,
    daysInMonth: parts.daysInMonth,
  };
}
