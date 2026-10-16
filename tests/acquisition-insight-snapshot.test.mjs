import test from "node:test";
import assert from "node:assert/strict";
import { acquisitionInsightSnapshot } from "../lib/acquisition-insight-snapshot.ts";
import { acquisitionQuery, buildAcquisitionReport } from "../lib/acquisition-report.ts";

const run = (id, since, until, finished) => ({ id, status: "SUCCEEDED", accountId: "act_fixture", campaignId: null, attributionKey: "7d_click,1d_view", requestedSince: since, requestedUntil: until, startedAt: new Date(finished), finishedAt: new Date(finished) });
const row = (date, syncRunId, values = {}) => ({ date, syncRunId, entityId: "ad_one", level: "ad", scopeKey: "account", attributionKey: "7d_click,1d_view", spendMinorUnits: 10000, impressions: 2000, reach: 1000, clicks: 100, linkClicks: 50, leads: 10, frequency: 2, resultActionType: "lead", rawActions: '[{"action_type":"lead","value":"8"}]', ...values });

test("later covering refreshes mask omitted rows across historical batches without using unrelated scopes", () => {
  const runs = [run("january", "2026-01-01", "2026-01-31", "2026-10-10"), run("february", "2026-02-01", "2026-02-28", "2026-10-11"), run("january-correction", "2026-01-01", "2026-01-31", "2026-10-12"), run("march", "2026-03-01", "2026-03-31", "2026-10-13")];
  const saved = [row("2026-01-01", "january"), row("2026-01-02", "january-correction"), row("2026-02-01", "february"), row("2026-02-02", "foreign-account"), row("2026-02-03", "february", { scopeKey: "campaign" }), row("2026-02-04", "february", { attributionKey: "1d_click" })];
  const snapshot = acquisitionInsightSnapshot(saved, runs, "lead");
  assert.equal(snapshot.omittedRows, 1); assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.rows[0].spendMinorUnits, null); assert.equal(snapshot.rows[0].leads, null); assert.equal(snapshot.rows[0].reach, null);
  assert.equal(snapshot.rows[1].spendMinorUnits, 10000); assert.equal(snapshot.rows[2].leads, 10);
  assert.equal(saved[0].spendMinorUnits, 10000, "retain the original audit row");
  const query = acquisitionQuery(new URLSearchParams({ since: "2026-01-01", until: "2026-01-31", compareSince: "2026-02-01", compareUntil: "2026-02-28" }), new Date("2026-10-14"));
  const report = buildAcquisitionReport({ query, insights: snapshot.rows, runs, names: new Map(), journey: null, metaOmittedRows: snapshot.omittedRows });
  assert.equal(report.rows[0].current.metrics.spendCents, null, "unknown rows cannot become a partial spend total");
  assert.equal(report.rows[0].comparison.metrics.spendCents, 10000);
  assert.equal(report.health.metaOmittedRows, 1);
});

test("failed refreshes preserve completed metrics; only matching saved event receipts recover missing leads", () => {
  const runs = [run("saved", "2026-02-01", "2026-02-28", "2026-10-10"), { ...run("failed", "2026-02-01", "2026-02-28", "2026-10-13"), status: "FAILED" }];
  const snapshot = acquisitionInsightSnapshot([row("2026-02-01", "saved", { leads: null }), row("2026-02-02", "saved", { leads: null, resultActionType: "other" }), row("2026-02-03", "failed")], runs, "lead");
  assert.equal(snapshot.omittedRows, 0); assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].spendMinorUnits, 10000); assert.equal(snapshot.rows[0].leads, 8); assert.equal(snapshot.rows[1].leads, null);
});

test("a successful refresh that skipped malformed rows cannot establish zero or partial delivery totals", () => {
  const runs = [run("complete", "2026-02-01", "2026-02-28", "2026-10-10"), { ...run("partial", "2026-02-01", "2026-02-28", "2026-10-13"), warning: "1 malformed insight row(s) were skipped." }];
  const query = acquisitionQuery(new URLSearchParams({ since: "2026-02-01", until: "2026-02-28", compareSince: "2026-02-01", compareUntil: "2026-02-28" }), new Date("2026-10-14"));
  const report = buildAcquisitionReport({ query, insights: [row("2026-02-01", "partial")], runs, journey: null, names: new Map() });
  assert.equal(report.health.currentCovered, false); assert.equal(report.rows[0].current.metrics.spendCents, null);
});

test("non-null results from a different configured event cannot become leads", () => {
  const runs = [run("saved", "2026-02-01", "2026-02-28", "2026-10-10")];
  const saved = [row("2026-02-01", "saved", { resultActionType: "purchase", leads: 10, rawActions: '[{"action_type":"lead","value":"2"}]' })];
  assert.equal(acquisitionInsightSnapshot(saved, runs, "lead").rows[0].leads, null);
  assert.equal(acquisitionInsightSnapshot([row("2026-02-01", "saved")], runs).rows[0].leads, null);
});
