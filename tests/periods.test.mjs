import test from "node:test";
import assert from "node:assert/strict";
import { accountLocalDate, chooseSyncRange, dateRangeForPeriod } from "../lib/periods.ts";

const londonDstStart = new Date("2026-03-29T23:30:00.000Z");

test("uses the account timezone for local dates across a daylight-saving boundary", () => {
  assert.equal(accountLocalDate(londonDstStart, "Europe/London"), "2026-03-30");
  assert.equal(accountLocalDate(londonDstStart, "UTC"), "2026-03-29");
  assert.deepEqual(dateRangeForPeriod("today", "Europe/London", londonDstStart), { since: "2026-03-30", until: "2026-03-30" });
  assert.deepEqual(dateRangeForPeriod("yesterday", "Europe/London", londonDstStart), { since: "2026-03-29", until: "2026-03-29" });
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
