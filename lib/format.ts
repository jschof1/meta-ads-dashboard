import { UKTL_CONFIG } from "./uktl-config";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type CurrencyFormatter = {
  formatter: Intl.NumberFormat;
  minorUnitScale: number;
};

function currencyFormatter(currencyCode: string): CurrencyFormatter | null {
  const code = currencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  try {
    const formatter = new Intl.NumberFormat(UKTL_CONFIG.locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
    });
    const fractionDigits = formatter.resolvedOptions().minimumFractionDigits ?? 2;
    return { formatter, minorUnitScale: 10 ** fractionDigits };
  } catch {
    return null;
  }
}

export function currencyMinorUnitScale(currencyCode: string | null | undefined): number | null {
  if (!currencyCode) return null;
  return currencyFormatter(currencyCode)?.minorUnitScale ?? null;
}

/** Format minor units using the currency returned by the Meta account. */
export function formatMoney(minorUnits: number | null | undefined, currencyCode: string | null | undefined): string {
  if (minorUnits == null) return "—";
  if (!currencyCode) return "Currency pending";
  const currency = currencyFormatter(currencyCode);
  if (!currency) return "Currency pending";
  return currency.formatter.format(minorUnits / currency.minorUnitScale);
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat(UKTL_CONFIG.locale).format(value);
}

export function formatPercent(value: number | null | undefined, fractionDigits = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

function validDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateFormatter(timeZone: string | null | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(UKTL_CONFIG.locale, { ...options, timeZone: timeZone || "UTC" });
  } catch {
    return new Intl.DateTimeFormat(UKTL_CONFIG.locale, { ...options, timeZone: "UTC" });
  }
}

/** Format a stored account-local date without allowing any timezone to change its day. */
export function formatDateLabel(value: string, timeZone: string | null | undefined): string {
  const date = validDate(value);
  if (!date) return value;
  // Meta daily insight dates are already stored as calendar dates in the
  // account timezone. Formatting that instant in UTC preserves the stored day
  // even for accounts at UTC-12 or UTC+14.
  void timeZone;
  return dateFormatter("UTC", { day: "2-digit", month: "short" }).format(date);
}

export function formatDateTime(value: string | null | undefined, timeZone: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter(timeZone, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function targetMoneyLabel(minorUnits: number | null | undefined, currencyCode: string | null | undefined): string {
  return minorUnits == null ? "Target not set" : formatMoney(minorUnits, currencyCode);
}

export function targetRateLabel(value: number | null | undefined, fractionDigits = 2): string {
  return value == null ? "Target not set" : formatPercent(value, fractionDigits);
}
