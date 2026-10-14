import test from "node:test";
import assert from "node:assert/strict";
import { buildMonthlyReport, monthlyMetrics, monthOutcomes, monthlyCsv } from "../lib/monthly-performance.ts";
import { addCalendarDays } from "../lib/periods.ts";
const row = (date, extra = {}) => ({ date, level: "account", entityId: "act_1", currencyCode: "GBP", spendMinorUnits: 1000, impressions: 100, linkClicks: 10, leads: 2, ...extra });
const range = (since, until, extra) => {
  const rows = []; for (let d = since; d <= until; d = addCalendarDays(d, 1)) rows.push(row(d, extra)); return rows;
};
const report = (rows, extra = {}) => buildMonthlyReport({ rows, accountId: "act_1", currency: "GBP", timezone: "Europe/London", attribution: "7d_click,1d_view", scope: "Whole ad account", metaCheckedAt: "2026-10-14T06:01:00Z", register: null, now: new Date("2026-10-14T15:00:00Z"), ...extra });

test("monthly rates use weighted totals, preserve unknown money and avoid unique reach", () => {
  const result = monthlyMetrics([row("2026-09-01"), row("2026-09-02", { spendMinorUnits: 3000, impressions: 900, linkClicks: 90, leads: 8 })], "GBP");
  assert.equal(result.cpl, 400); assert.equal(result.ctr, 0.1); assert.equal(result.linkCpc, 40); assert.equal(result.cpm, 4000);
  assert.equal(monthlyMetrics([row("2026-09-01", { currencyCode: "USD" })], "GBP").spend, null);
  assert.equal(monthlyMetrics([row("2026-09-01", { leads: null })], "GBP").cpl, null);
  assert.equal(monthlyMetrics([row("2026-09-01", { leads: 0 })], "GBP").cpl, null);
  assert.equal(monthlyMetrics([], "GBP").spend, null); assert.ok(!("reach" in result));
});
test("full calendar months compare, current month compares matched elapsed complete days only", () => {
  const result = report([...range("2026-08-01", "2026-09-30"), ...range("2026-10-01", "2026-10-14", { spendMinorUnits: 2000 })]);
  assert.equal(result.months[0].comparison.spendChange, 1);
  assert.match(result.months[0].comparison.label, /1–13.*excludes today/);
  assert.equal(result.months[0].metrics.spend, 28000);
  assert.equal(result.months[1].comparison.leadChange, (30 - 31) / 31);
});
test("missing days label partial and suppress comparison without converting missing into zero", () => {
  const result = report([...range("2026-09-02", "2026-09-30"), ...range("2026-10-01", "2026-10-14")]);
  assert.equal(result.months[1].coverage, "partial"); assert.equal(result.months[1].days, 29);
  assert.equal(result.months[0].comparison, null); assert.equal(result.months[0].outcomes, null);
});
test("account totals never double count entity levels and exclude dates before the reporting baseline", () => {
  const result = report([row("2025-01-01"), ...range("2026-09-01", "2026-10-14"), row("2026-09-01", { level: "ad", entityId: "ad1", spendMinorUnits: 10000 }), row("2026-09-01", { entityId: "act_other", spendMinorUnits: 999999 })], { names: { ad1: "Real ad" } });
  assert.equal(result.months.length, 2); assert.equal(result.months[1].metrics.spend, 30000);
  assert.equal(result.months[1].ads[0].name, "Real ad"); assert.equal(result.months[1].ads[0].spendShare, 1 / 3);
});
const entry = (id, extra = {}) => ({ contactId: id, contactFound: true, contactCreated: "2026-09-10T10:00:00Z", name: "Private person", source: "", tags: [], test: false, metaSource: "", submissions: [], appointments: [], ...extra });
const register = { checkedAt: "2026-10-14T14:52:00Z", coverageStart: "2026-06-11T12:00:00Z", calendarEnd: "2027-01-12T14:52:00Z", entries: [entry("1", { metaSource: "Facebook", submissions: [{ id: "r1", at: "2026-09-30T23:30:00Z" }, { id: "r2", at: "2026-10-01T12:00:00Z" }], appointments: [{ id: "e1", at: "2026-10-10T12:00:00Z", status: "confirmed" }, { id: "e2", at: "2026-10-11T12:00:00Z", status: "cancelled" }, { id: "e3", at: "2026-10-12T12:00:00Z", status: "No Show" }, { id: "future", at: "2026-10-20T12:00:00Z", status: "confirmed" }] }), entry("2", { submissions: [{ id: "r2", at: "2026-10-01T12:00:00Z" }] }), entry("test", { test: true, submissions: [{ id: "r3", at: "2026-10-02T12:00:00Z" }] })] };
test("outcomes respect timezone, receipt/event deduplication, tests, cancellations and saved cutoff", () => {
  const result = monthOutcomes(register, "2026-10-01", "2026-10-14", "Europe/London");
  assert.equal(result.peopleEnquiring, 1); assert.equal(result.receipts, 2);
  assert.equal(result.appointments, 2); assert.equal(result.bookers, 1); assert.equal(result.cancelled, 1); assert.equal(result.confirmed, 1); assert.equal(result.noShows, 1);
  assert.equal(monthOutcomes(register, "2026-06-01", "2026-06-30", "Europe/London"), null);
  assert.equal(monthOutcomes(register, "2026-10-01", "2026-10-15", "Europe/London"), null);
  assert.equal(monthOutcomes(register, "2026-09-01", "2026-09-30", "Europe/London").metaSourcedContacts, 1);
});
test("current HighLevel month is partial and exported report contains aggregate evidence only", () => {
  const result = report(range("2026-09-01", "2026-10-14"), { register });
  assert.equal(result.months[0].outcomeCoverage, "partial"); assert.equal(result.months[1].outcomeCoverage, "complete");
  const csv = monthlyCsv(result); assert.match(csv, /Meta saved at/); assert.match(csv, /MTD \/ complete/);
  assert.ok(!csv.includes("Private person")); assert.ok(!JSON.stringify(result).includes("Private person"));
  assert.ok(!("revenue" in result.months[0]));
});
test("month comparisons reject a missing prior date and a shorter prior month", () => {
  const result = report([...range("2026-02-01", "2026-03-31")], { now: new Date("2026-03-31T15:00:00Z") });
  assert.equal(result.months[0].comparison, null);
});

test("November 2025 remains reportable after it is older than twelve months", () => {
  const result = report([...range("2025-11-20", "2025-11-30"), row("2026-12-01")], { now: new Date("2026-12-02T12:00:00Z") });
  assert.equal(result.months.length, 14);
  const november = result.months.at(-1);
  assert.equal(november.month, "2025-11");
  assert.equal(november.metrics.spend, 11000);
  assert.equal(november.days, 11);
  assert.equal(november.expectedDays, 30);
  assert.equal(november.coverage, "partial");
  assert.equal(result.months.find(m => m.month === "2026-01").metrics.spend, null, "missing months remain unknown");
});
