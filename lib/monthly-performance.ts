import type { LeadRegister } from "./lead-register";
import { accountLocalDate, addCalendarDays } from "./periods";

// Retain the agreed reporting baseline as time passes; this is not a rolling window.
export const MONTHLY_HISTORY_START = "2025-11-01";

export type MonthlyInsight = {
  date: string; level: string; entityId: string; currencyCode: string | null;
  spendMinorUnits: number | null; impressions: number | null; linkClicks: number | null; leads: number | null;
};
export type MonthlyMetrics = {
  spend: number | null; impressions: number | null; linkClicks: number | null; leads: number | null;
  cpl: number | null; linkCpc: number | null; ctr: number | null; cpm: number | null;
};
export type MonthlyOutcomes = {
  contacts: number; metaSourcedContacts: number; peopleEnquiring: number; receipts: number;
  appointments: number; bookers: number; confirmed: number; cancelled: number; noShows: number;
};
export type MonthlyEntity = MonthlyMetrics & { id: string; name: string; spendShare: number | null };
export type PerformanceMonth = {
  month: string; since: string; until: string; days: number; expectedDays: number;
  coverage: "complete" | "partial" | "missing"; current: boolean; metrics: MonthlyMetrics;
  outcomes: MonthlyOutcomes | null; outcomeCoverage: "complete" | "partial" | "missing";
  campaigns: MonthlyEntity[]; ads: MonthlyEntity[];
  comparison: { label: string; spendChange: number | null; leadChange: number | null; cplChange: number | null } | null;
};
export type MonthlyReport = {
  currency: string; timezone: string; attribution: string; scope: string;
  metaCheckedAt: string | null; crmCheckedAt: string | null; crmCoverageStart: string | null;
  generatedAt: string; months: PerformanceMonth[];
};

function sum(rows: MonthlyInsight[], field: "spendMinorUnits" | "impressions" | "linkClicks" | "leads") {
  return rows.length && rows.every(r => r[field] != null) ? rows.reduce((total, r) => total + r[field]!, 0) : null;
}
const ratio = (a: number | null, b: number | null, scale = 1) => a != null && b != null && b > 0 ? a / b * scale : null;
export function monthlyMetrics(rows: MonthlyInsight[], currency: string): MonthlyMetrics {
  // Currency mismatches are unknown, never silently combined into money totals.
  const spend = rows.every(r => r.currencyCode === currency) ? sum(rows, "spendMinorUnits") : null;
  const impressions = sum(rows, "impressions"), linkClicks = sum(rows, "linkClicks"), leads = sum(rows, "leads");
  return { spend, impressions, linkClicks, leads, cpl: ratio(spend, leads), linkCpc: ratio(spend, linkClicks), ctr: ratio(linkClicks, impressions), cpm: ratio(spend, impressions, 1000) };
}
function monthEnd(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}
function previousMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}
function dates(since: string, until: string) {
  const result: string[] = [];
  for (let d = since; d <= until; d = addCalendarDays(d, 1)) result.push(d);
  return result;
}
const inRange = (rows: MonthlyInsight[], since: string, until: string) => rows.filter(r => r.date >= since && r.date <= until);
const delta = (a: number | null, b: number | null) => a != null && b != null && b > 0 ? (a - b) / b : null;

export function monthOutcomes(register: LeadRegister | null, since: string, until: string, timezone: string): MonthlyOutcomes | null {
  if (!register) return null;
  const start = new Date(register.coverageStart), checked = new Date(register.checkedAt);
  if (!Number.isFinite(+start) || !Number.isFinite(+checked)) return null;
  // The first collection began part way through its start date; that day isn't full coverage.
  if (since <= accountLocalDate(start, timezone) || until > accountLocalDate(checked, timezone)) return null;
  const within = (value: string) => {
    const instant = new Date(value);
    if (!Number.isFinite(+instant) || +instant > +checked) return false;
    const date = accountLocalDate(instant, timezone);
    return date >= since && date <= until;
  };
  const result: MonthlyOutcomes = { contacts: 0, metaSourcedContacts: 0, peopleEnquiring: 0, receipts: 0, appointments: 0, bookers: 0, confirmed: 0, cancelled: 0, noShows: 0 };
  const contacts = new Set<string>(), people = new Set<string>(), receipts = new Set<string>(), events = new Set<string>(), bookers = new Set<string>();
  for (const entry of register.entries) {
    if (entry.test) continue;
    if (entry.contactFound && within(entry.contactCreated) && !contacts.has(entry.contactId)) {
      contacts.add(entry.contactId); result.contacts++;
      if (entry.metaSource) result.metaSourcedContacts++;
    }
    for (const receipt of entry.submissions) if (within(receipt.at) && !receipts.has(receipt.id)) {
      receipts.add(receipt.id); people.add(entry.contactId);
    }
    for (const appointment of entry.appointments) if (within(appointment.at) && !events.has(appointment.id)) {
      events.add(appointment.id);
      const status = appointment.status.toLowerCase().replace(/[\s_-]/g, "");
      if (status === "cancelled" || status === "canceled") result.cancelled++;
      else { result.appointments++; bookers.add(entry.contactId); }
      if (status === "confirmed") result.confirmed++;
      if (status === "noshow") result.noShows++;
    }
  }
  result.receipts = receipts.size; result.peopleEnquiring = people.size; result.bookers = bookers.size;
  return result;
}

export function buildMonthlyReport(input: {
  rows: MonthlyInsight[]; accountId: string; currency: string; timezone: string; attribution: string; scope: string;
  metaCheckedAt: string | null; register: LeadRegister | null; names?: Record<string, string>; now?: Date;
}): MonthlyReport {
  const now = input.now ?? new Date(), today = accountLocalDate(now, input.timezone), thisMonth = today.slice(0, 7);
  const rows = input.rows.filter(r => r.date >= MONTHLY_HISTORY_START && r.date <= today);
  const accounts = rows.filter(r => r.level === "account" && r.entityId === input.accountId);
  const first = accounts.map(r => r.date.slice(0, 7)).sort()[0];
  const months: PerformanceMonth[] = [];
  const complete = (values: MonthlyInsight[], since: string, until: string) => {
    const days = dates(since, until), saved = new Set(values.map(r => r.date));
    return days.length > 0 && days.every(d => saved.has(d));
  };
  if (first) for (let month = thisMonth; month >= first; month = previousMonth(month)) {
    const since = `${month}-01`, current = month === thisMonth, until = current ? today : monthEnd(month);
    const values = inRange(accounts, since, until), days = new Set(values.map(r => r.date)).size;
    const metrics = monthlyMetrics(values, input.currency);
    const entityRows = inRange(rows, since, until);
    const entities = (level: string) => {
      const grouped = new Map<string, MonthlyInsight[]>();
      for (const row of entityRows.filter(r => r.level === level)) grouped.set(row.entityId, [...(grouped.get(row.entityId) ?? []), row]);
      return [...grouped].map(([id, values]) => {
        const m = monthlyMetrics(values, input.currency);
        return { ...m, id, name: input.names?.[id] ?? id, spendShare: ratio(m.spend, metrics.spend) };
      }).sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1));
    };
    const outcomes = monthOutcomes(input.register, since, until, input.timezone);
    let comparison: PerformanceMonth["comparison"] = null;
    const prev = previousMonth(month), compareUntil = current ? addCalendarDays(today, -1) : until;
    const previousUntil = current ? `${prev}-${compareUntil.slice(8)}` : monthEnd(prev);
    if ((!current || compareUntil >= since) && previousUntil <= monthEnd(prev)) {
      const a = inRange(accounts, since, compareUntil), b = inRange(accounts, `${prev}-01`, previousUntil);
      if (complete(a, since, compareUntil) && complete(b, `${prev}-01`, previousUntil)) {
        const am = monthlyMetrics(a, input.currency), bm = monthlyMetrics(b, input.currency);
        comparison = { label: current ? `1–${Number(compareUntil.slice(8))} ${month} vs 1–${Number(compareUntil.slice(8))} ${prev}; excludes today` : `${month} vs ${prev}; full calendar months`, spendChange: delta(am.spend, bm.spend), leadChange: delta(am.leads, bm.leads), cplChange: delta(am.cpl, bm.cpl) };
      }
    }
    const checkedDay = input.register ? accountLocalDate(new Date(input.register.checkedAt), input.timezone) : null;
    months.push({ month, since, until, current, days, expectedDays: dates(since, until).length, coverage: days === 0 ? "missing" : complete(values, since, until) ? "complete" : "partial", metrics, outcomes, outcomeCoverage: outcomes ? checkedDay && until >= checkedDay ? "partial" : "complete" : "missing", campaigns: entities("campaign"), ads: entities("ad"), comparison });
  }
  return { currency: input.currency, timezone: input.timezone, attribution: input.attribution, scope: input.scope, metaCheckedAt: input.metaCheckedAt, crmCheckedAt: input.register?.checkedAt ?? null, crmCoverageStart: input.register?.coverageStart ?? null, generatedAt: now.toISOString(), months };
}

export function monthlyCsv(report: MonthlyReport) {
  const cell = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const money = (n: number | null) => n == null ? null : (n / 10 ** new Intl.NumberFormat("en", { style: "currency", currency: report.currency }).resolvedOptions().maximumFractionDigits!).toFixed(2);
  const header = ["Month", "Meta coverage", "Saved days", "Expected days", "Currency", "Spend", "Meta leads", "CPL", "Impressions", "Link clicks", "Link CTR %", "Link CPC", "CPM", "CRM coverage", "Form people", "Receipts", "New CRM contacts", "Meta sourced contacts", "Appointments excluding cancelled", "Booked people", "Confirmed", "Cancelled", "No shows", "Meta saved at", "CRM saved at", "Attribution", "Scope"];
  return [header, ...report.months.map(m => [m.month, m.current ? `MTD / ${m.coverage}` : m.coverage, m.days, m.expectedDays, report.currency, money(m.metrics.spend), m.metrics.leads, money(m.metrics.cpl), m.metrics.impressions, m.metrics.linkClicks, m.metrics.ctr == null ? null : (m.metrics.ctr * 100).toFixed(2), money(m.metrics.linkCpc), money(m.metrics.cpm), m.outcomeCoverage, m.outcomes?.peopleEnquiring ?? null, m.outcomes?.receipts ?? null, m.outcomes?.contacts ?? null, m.outcomes?.metaSourcedContacts ?? null, m.outcomes?.appointments ?? null, m.outcomes?.bookers ?? null, m.outcomes?.confirmed ?? null, m.outcomes?.cancelled ?? null, m.outcomes?.noShows ?? null, report.metaCheckedAt, report.crmCheckedAt, report.attribution, report.scope])].map(row => row.map(cell).join(",")).join("\r\n");
}
