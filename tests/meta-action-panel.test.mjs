import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaActionPanel } from "../components/meta-action-panel.tsx";

const evidence = {
  evidenceVersion: 1,
  ruleVersion: "pr06.v1",
  comparisonDays: 7,
  ranges: { current: { since: "2026-08-29", until: "2026-09-04" }, previous: null, cumulative: null },
  sampleSize: 3,
  seriesPoints: 0,
  daysActive: 14,
  confidenceScore: 75,
  confidenceFactors: {},
  status: "ACTIVE",
  learningState: null,
  current: { spendCents: 24_000, impressions: 12_000, reach: 9_000, clicks: 240, linkClicks: 120, leads: 3, frequency: 1.33, cplCents: 8_000, cpmCents: 200, cpcCents: 100, ctrLink: 1 },
  previous: null,
  cumulative: null,
  series: [],
  deltas: { spendPct: null, leadsPct: null, cplPct: null, ctrPct: null, frequencyPct: null },
  thresholds: {},
  notes: ["Browser-visible evidence"],
};

function state(overrides = {}) {
  return {
    meta: {
      currencyCode: "GBP",
      actionGate: {
        writesEnabled: false,
        status: "disabled",
        message: "Meta writes are disabled. Prepare and approve actions locally; enabling live execution requires the explicit safety gate.",
      },
    },
    metaActions: [],
    recommendations: [],
    ads: [],
    adSets: [],
    ...overrides,
  };
}

function action(status = "PROPOSED") {
  return {
    id: "action-panel-test",
    accountId: "act_panel-test",
    action: "pause_ad",
    targetType: "ad",
    targetId: "ad-panel-test",
    targetName: "Panel test ad",
    status,
    requestedChange: { status: "PAUSED" },
    expectedState: { status: "ACTIVE", dailyBudgetMinor: null },
    oldValue: null,
    newValue: null,
    reasoning: "Server-sourced reason shown before approval",
    evidence,
    confidence: "high",
    source: "operator",
    recommendationFingerprint: "panel-recommendation",
    sourceSyncRunId: "panel-sync",
    metaObjectId: null,
    metaTraceId: null,
    error: null,
    createdAt: "2026-09-05T12:00:00.000Z",
    approvedAt: status === "APPROVED" ? "2026-09-05T12:01:00.000Z" : null,
    approvedBy: status === "APPROVED" ? "operator" : null,
    rejectedAt: null,
    rejectedBy: null,
    executingAt: null,
    executedAt: null,
    failedAt: null,
    updatedAt: "2026-09-05T12:01:00.000Z",
  };
}

test("action panel renders server evidence and only the correct transition controls", () => {
  const proposed = renderToStaticMarkup(React.createElement(MetaActionPanel, { state: state({ metaActions: [action()] }) }));
  assert.match(proposed, /Pause ad: ACTIVE → PAUSED/);
  assert.match(proposed, /Server-sourced reason shown before approval/);
  assert.match(proposed, /high confidence/);
  assert.match(proposed, /Evidence: £240\.00 spend, 3 leads, £80\.00 CPL/);
  assert.match(proposed, /Approve</);
  assert.match(proposed, /Reject</);
  assert.doesNotMatch(proposed, /Execute approved change/);

  const approved = renderToStaticMarkup(React.createElement(MetaActionPanel, { state: state({ metaActions: [action("APPROVED")] }) }));
  assert.match(approved, /Execute approved change/);
  assert.match(approved, /disabled/);
  assert.match(approved, /Meta writes are disabled/);
});

test("scale recommendations render a currency-aware budget input and keep preparation disabled until valid input", () => {
  const markup = renderToStaticMarkup(React.createElement(MetaActionPanel, {
    state: state({
      recommendations: [{
        fingerprint: "scale-recommendation",
        sourceSyncRunId: "scale-sync",
        type: "scale_candidate",
        target: { type: "adset", id: "adset-panel-test", name: "Panel test ad set" },
        reason: "Server-sourced scale reason",
        confidence: "high",
        evidence,
      }],
      adSets: [{ adSetId: "adset-panel-test", dailyBudgetMinor: 10_000 }],
    }),
  }));
  assert.match(markup, /New daily budget \(GBP\)/);
  assert.match(markup, /Current budget unknown|£100\.00/);
  assert.match(markup, /Prepare approval/);
  assert.match(markup, /disabled/);
});
