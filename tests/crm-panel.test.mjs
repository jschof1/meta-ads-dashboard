import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmAttributionPanel } from "../components/crm-attribution-panel.tsx";

test("labels a fresh but partial HighLevel snapshot as partial", () => {
  const markup = renderToStaticMarkup(React.createElement(CrmAttributionPanel, {
    state: {
      meta: { currencyCode: "GBP", timezoneName: "Europe/London" },
      crm: {
        status: "fresh",
        configured: true,
        syncEnabled: true,
        locationId: "location-1",
        pipelineId: "pipeline-1",
        mappingReady: true,
        mappingHash: "mapping-hash",
        lastSyncAt: "2026-09-05T12:00:00.000Z",
        lastAttemptAt: "2026-09-05T12:00:00.000Z",
        lastAttemptStatus: "SUCCEEDED",
        lastError: null,
        period: { since: "2026-08-07", until: "2026-09-05", label: "Last 30 days" },
        counts: {
          crmRecords: null,
          attributedRecords: 1,
          paidMetaRecords: 1,
          metaLeads: 1,
          contacted: 1,
          qualified: 1,
          callsBooked: 0,
          callsAttended: 0,
          wonCustomers: 0,
          lostCustomers: 0,
        },
        rates: { leadToContacted: 1, contactedToQualified: 1, qualifiedToBooked: 0, bookedToAttended: null, attendedToWon: null, showRate: null, closeRate: null },
        costs: { qualifiedLeadCostMinorUnits: 1000, bookedCallCostMinorUnits: null, customerCacMinorUnits: null },
        revenue: { minorUnits: null, currencyCode: "GBP", status: "unknown", roas: null },
        attributionBreakdown: [],
        performanceByEntity: [],
        warnings: ["HighLevel contact polling reached HIGHLEVEL_MAX_RECORDS; the stored contact snapshot is partial."],
        dataQuality: "partial",
      },
    },
  }));

  assert.match(markup, /HighLevel snapshot partial/);
  assert.doesNotMatch(markup, /HighLevel snapshot fresh/);
  assert.match(markup, /totals, rates, costs and revenue are withheld/);
});
