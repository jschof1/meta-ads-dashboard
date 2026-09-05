import test from "node:test";
import assert from "node:assert/strict";
import { buildTriggers, detectAnomalies, scoreFatigue } from "../lib/insights.ts";

const base = {
  frequency: 3.5,
  ctrLink: 0.005,
  cplCents: 2_000,
  impressions: 1_000,
  leads: 3,
  daysActive: 10,
  spendCents: 6_000,
  previousFrequency: 2,
  previousCtrLink: 0.02,
  previousCplCents: 1_000,
  previousImpressions: 1_000,
  previousLeads: 3,
  previousSpendCents: 3_000,
};

test("withholds fatigue alerts until rate and lead evidence clears thresholds", () => {
  const result = scoreFatigue({ ...base, impressions: 999, leads: 2 });
  assert.equal(result.score, 0);
  assert.match(result.reason, /Not enough .*stored evidence/);
});

test("scores fatigue only after sufficient stored evidence", () => {
  const result = scoreFatigue(base);
  assert.ok(result.score >= 0.6);
  assert.match(result.reason, /frequency/);
});

test("derives anomaly baselines from aggregated numerators rather than averaging daily ratios", () => {
  const anomalies = detectAnomalies([
    { date: "2026-09-01", spendCents: 100, impressions: 100, linkClicks: 10, leads: 1, cplCents: 100, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-02", spendCents: 9_900, impressions: 9_900, linkClicks: 990, leads: 99, cplCents: 100, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-03", spendCents: 1_000, impressions: 1_000, linkClicks: 100, leads: 1, cplCents: 1000, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-04", spendCents: 6_000, impressions: 1_000, linkClicks: 50, leads: 3, cplCents: 2000, cpmCents: 6000, cpcCents: null, ctrLink: 0.05, frequency: null },
  ]);
  const cpl = anomalies.find((anomaly) => anomaly.metric === "cpl");
  assert.equal(cpl.changePct, 1736);
});

test("withholds anomalies when the latest rate sample is below configured minimums", () => {
  const anomalies = detectAnomalies([
    { date: "2026-09-01", spendCents: 100, impressions: 100, linkClicks: 10, leads: 1, cplCents: 100, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-02", spendCents: 100, impressions: 100, linkClicks: 10, leads: 1, cplCents: 100, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-03", spendCents: 100, impressions: 100, linkClicks: 10, leads: 1, cplCents: 100, cpmCents: 1000, cpcCents: null, ctrLink: 0.1, frequency: null },
    { date: "2026-09-04", spendCents: 9_900, impressions: 1, linkClicks: 1, leads: 1, cplCents: 9_900, cpmCents: 9_900_000, cpcCents: null, ctrLink: 1, frequency: null },
  ]);
  assert.deepEqual(anomalies, []);
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
