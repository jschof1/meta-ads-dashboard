import test from "node:test";
import assert from "node:assert/strict";
import { buildTriggers, scoreFatigue } from "../lib/insights.ts";

const base = {
  frequency: 3.5,
  ctrLink: 0.005,
  cplCents: 2_000,
  impressions: 1_000,
  leads: 3,
  daysActive: 10,
  spendCents: 6_000,
};

test("withholds fatigue alerts until rate and lead evidence clears thresholds", () => {
  const result = scoreFatigue({ ...base, impressions: 999, leads: 2 });
  assert.equal(result.score, 0);
  assert.match(result.reason, /Not enough stored evidence/);
});

test("scores fatigue only after sufficient stored evidence", () => {
  const result = scoreFatigue(base);
  assert.ok(result.score >= 0.6);
  assert.match(result.reason, /frequency/);
});

test("keeps the fatigue trigger pending when any creative lacks sufficient evidence", () => {
  const triggers = buildTriggers({
    cplCentsLast7: null,
    currencyCode: "GBP",
    frequencyLast7: null,
    leadsThisWeek: null,
    daysSinceLaunch: null,
    ads: [{ adName: "Small sample", fatigueScore: 0, evidenceStatus: "thin" }],
  });
  assert.equal(triggers.find((trigger) => trigger.id === "fatigue").status, "pending");
});
