export type ReportingPeriod =
  | "today"
  | "yesterday"
  | "mtd"
  | "7d"
  | "previous7d"
  | "14d"
  | "previous14d"
  | "30d"
  | "previous30d";

export type DateRange = {
  since: string;
  until: string;
};

export type SyncRange = DateRange & {
  initialBackfill: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateParts(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
}

function parseIsoDate(value: string): Date {
  if (!ISO_DATE.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ISO date: ${value}`);
  return date;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function accountLocalDate(now = new Date(), timeZone = "UTC"): string {
  return dateParts(now, timeZone);
}

export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function dateRangeForPeriod(
  period: ReportingPeriod,
  timeZone = "UTC",
  now = new Date(),
): DateRange {
  const today = accountLocalDate(now, timeZone);
  switch (period) {
    case "today":
      return { since: today, until: today };
    case "yesterday": {
      const yesterday = addCalendarDays(today, -1);
      return { since: yesterday, until: yesterday };
    }
    case "mtd":
      return { since: `${today.slice(0, 8)}01`, until: today };
    case "7d":
      return { since: addCalendarDays(today, -6), until: today };
    case "previous7d":
      return { since: addCalendarDays(today, -13), until: addCalendarDays(today, -7) };
    case "14d":
      return { since: addCalendarDays(today, -13), until: today };
    case "previous14d":
      return { since: addCalendarDays(today, -27), until: addCalendarDays(today, -14) };
    case "30d":
      return { since: addCalendarDays(today, -29), until: today };
    case "previous30d":
      return { since: addCalendarDays(today, -59), until: addCalendarDays(today, -30) };
  }
}

export function chooseSyncRange(input: {
  timeZone?: string;
  now?: Date;
  hasSuccessfulSync: boolean;
  initialBackfillDays?: number;
  recentRefreshDays?: number;
}): SyncRange {
  const timeZone = input.timeZone || "UTC";
  const today = accountLocalDate(input.now, timeZone);
  const days = Math.max(
    1,
    input.hasSuccessfulSync
      ? Math.floor(input.recentRefreshDays ?? 7)
      : Math.floor(input.initialBackfillDays ?? 90),
  );
  return {
    since: addCalendarDays(today, -(days - 1)),
    until: today,
    initialBackfill: !input.hasSuccessfulSync,
  };
}

export function isDateInRange(date: string, range: DateRange): boolean {
  return ISO_DATE.test(date) && date >= range.since && date <= range.until;
}
