import test from "node:test";
import assert from "node:assert/strict";
import { accountLocalDate, chooseSyncRange, dateRangeForPeriod, isDateInRange } from "../lib/periods.ts";

const londonDstStart = new Date("2026-03-29T23:30:00.000Z");

test("uses the account timezone for local dates across a daylight-saving boundary", () => {
  assert.equal(accountLocalDate(londonDstStart, "Europe/London"), "2026-03-30");
  assert.equal(accountLocalDate(londonDstStart, "UTC"), "2026-03-29");
  assert.deepEqual(dateRangeForPeriod("today", "Europe/London", londonDstStart), { since: "2026-03-30", until: "2026-03-30" });
  assert.deepEqual(dateRangeForPeriod("yesterday", "Europe/London", londonDstStart), { since: "2026-03-29", until: "2026-03-29" });
});

test("keeps local calendar boundaries correct at the end of daylight saving time", () => {
  const beforeFallback = new Date("2026-11-01T03:30:00.000Z");
  const afterFallback = new Date("2026-11-01T05:30:00.000Z");
  assert.equal(accountLocalDate(beforeFallback, "America/New_York"), "2026-10-31");
  assert.equal(accountLocalDate(afterFallback, "America/New_York"), "2026-11-01");
  assert.deepEqual(dateRangeForPeriod("yesterday", "America/New_York", afterFallback), { since: "2026-10-31", until: "2026-10-31" });
});

test("falls back to UTC for an invalid timezone without throwing", () => {
  const now = new Date("2026-09-04T23:30:00.000Z");
  assert.equal(accountLocalDate(now, "Mars/Olympus"), "2026-09-04");
  assert.deepEqual(chooseSyncRange({ timeZone: "Mars/Olympus", now, hasSuccessfulSync: false }), {
    since: "2026-06-07",
    until: "2026-09-04",
    initialBackfill: true,
  });
});

test("returns calendar-aligned current and previous comparison windows", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  assert.deepEqual(dateRangeForPeriod("mtd", "Europe/London", now), { since: "2026-09-01", until: "2026-09-04" });
  assert.deepEqual(dateRangeForPeriod("7d", "Europe/London", now), { since: "2026-08-29", until: "2026-09-04" });
  assert.deepEqual(dateRangeForPeriod("previous7d", "Europe/London", now), { since: "2026-08-22", until: "2026-08-28" });
  assert.deepEqual(dateRangeForPeriod("14d", "Europe/London", now), { since: "2026-08-22", until: "2026-09-04" });
  assert.deepEqual(dateRangeForPeriod("previous14d", "Europe/London", now), { since: "2026-08-08", until: "2026-08-21" });
  assert.deepEqual(dateRangeForPeriod("30d", "Europe/London", now), { since: "2026-08-06", until: "2026-09-04" });
  assert.deepEqual(dateRangeForPeriod("previous30d", "Europe/London", now), { since: "2026-07-07", until: "2026-08-05" });
});

test("keeps the first sync as a 90-day inclusive backfill and later syncs as recent refreshes", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  assert.deepEqual(chooseSyncRange({ timeZone: "Europe/London", now, hasSuccessfulSync: false }), {
    since: "2026-06-07",
    until: "2026-09-04",
    initialBackfill: true,
  });
  assert.deepEqual(chooseSyncRange({ timeZone: "Europe/London", now, hasSuccessfulSync: true }), {
    since: "2026-08-29",
    until: "2026-09-04",
    initialBackfill: false,
  });
});

test("rejects impossible calendar dates before storing provider rows", () => {
  const range = { since: "2026-02-01", until: "2026-03-01" };
  assert.equal(isDateInRange("2026-02-28", range), true);
  assert.equal(isDateInRange("2026-02-30", range), false);
  assert.equal(isDateInRange("2026-2-03", range), false);
  assert.equal(isDateInRange("2026-02-15", { since: "2026-03-01", until: "2026-02-01" }), false);
});
