import test from "node:test";
import assert from "node:assert/strict";
import { buildCrmMetrics } from "../lib/crm-metrics.ts";

function contact(id, overrides = {}) {
  return {
    highLevelId: id,
    locationId: "location-1",
    dateAdded: "2026-09-04T10:00:00.000Z",
    attributionGranularity: "unattributed",
    metaAdId: null,
    metaCampaignId: null,
    ...overrides,
  };
}

function opportunity(id, overrides = {}) {
  return {
    highLevelId: id,
    locationId: "location-1",
    contactId: null,
    pipelineId: "pipeline-1",
    status: "open",
    semanticStage: null,
    valueMajorUnits: null,
    createdAtProvider: "2026-09-04T11:00:00.000Z",
    updatedAtProvider: "2026-09-04T11:00:00.000Z",
    lastStageChangeAt: null,
    lastStatusChangeAt: null,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    scope: { locationId: "location-1", pipelineId: "pipeline-1" },
    contacts: [],
    opportunities: [],
    period: { since: "2026-08-06", until: "2026-09-04", timeZone: "Europe/London", label: "Last 30 days" },
    meta: {
      spendMinorUnits: 10_000,
      leads: 10,
      currencyCode: "GBP",
      entities: [
        { granularity: "campaign", id: "campaign-1", name: "UKTL Leads", spendMinorUnits: 10_000, leads: 10 },
        { granularity: "ad", id: "ad-1", name: "Local lead angle", spendMinorUnits: 4_000, leads: 4 },
      ],
    },
    highLevelCurrencyCode: "GBP",
    ...overrides,
  };
}

test("keeps Meta leads, CRM records, paid-Meta records and outcomes distinct", () => {
  const result = buildCrmMetrics(input({
    contacts: [
      contact("c-ad", { attributionGranularity: "ad", metaAdId: "ad-1", metaCampaignId: "campaign-1" }),
      contact("c-campaign", { attributionGranularity: "campaign", metaCampaignId: "campaign-1", dateAdded: "2026-09-03T10:00:00.000Z" }),
      contact("c-paid", { attributionGranularity: "paid-meta", dateAdded: "2026-09-02T10:00:00.000Z" }),
      contact("c-unattributed", { dateAdded: "2026-09-01T10:00:00.000Z" }),
    ],
    opportunities: [
      opportunity("o-ad", { contactId: "c-ad", semanticStage: "wonCustomer", status: "won", valueMajorUnits: 100 }),
      opportunity("o-campaign", { contactId: "c-campaign", semanticStage: "qualified" }),
      opportunity("o-paid", { contactId: "c-paid", semanticStage: "callAttended" }),
      opportunity("o-lost", { contactId: "c-unattributed", semanticStage: "lost", status: "lost" }),
    ],
  }));

  assert.deepEqual(result.counts, {
    crmRecords: 4,
    attributedRecords: 3,
    paidMetaRecords: 3,
    metaLeads: 10,
    contacted: 3,
    qualified: 3,
    callsBooked: 2,
    callsAttended: 2,
    wonCustomers: 1,
    lostCustomers: 1,
  });
  assert.equal(result.rates.showRate, 1);
  assert.equal(result.rates.closeRate, 0.5);
  assert.equal(result.costs.qualifiedLeadCostMinorUnits, 3333);
  assert.equal(result.costs.bookedCallCostMinorUnits, 5000);
  assert.equal(result.costs.customerCacMinorUnits, 10000);
  assert.equal(result.revenue.minorUnits, 10000);
  assert.equal(result.revenue.status, "complete");
  assert.equal(result.revenue.roas, 1);
  assert.deepEqual(result.attributionBreakdown.map((row) => [row.granularity, row.records]), [["ad", 1], ["campaign", 1], ["paid-meta", 1], ["unattributed", 1]]);
  const ad = result.performanceByEntity.find((row) => row.granularity === "ad");
  assert.equal(ad.qualifiedLeads, 1);
  assert.equal(ad.wonCustomers, 1);
  assert.equal(ad.customerCacMinorUnits, 4000);
  const campaign = result.performanceByEntity.find((row) => row.granularity === "campaign");
  assert.equal(campaign.qualifiedLeads, 2);
  assert.equal(campaign.wonCustomers, 1);
});

test("does not claim revenue when currency or won values are incomplete", () => {
  const base = input({
    contacts: [contact("c-won", { attributionGranularity: "campaign", metaCampaignId: "campaign-1" })],
    opportunities: [opportunity("o-won", { contactId: "c-won", semanticStage: "wonCustomer", status: "won", valueMajorUnits: null })],
  });
  const missingValue = buildCrmMetrics(base);
  assert.equal(missingValue.revenue.minorUnits, null);
  assert.equal(missingValue.revenue.status, "incomplete");
  assert.equal(missingValue.revenue.roas, null);

  const mismatched = buildCrmMetrics({ ...base, highLevelCurrencyCode: "USD" });
  assert.equal(mismatched.revenue.status, "incomplete");
  assert.equal(mismatched.revenue.minorUnits, null);
});

test("does not turn unattributed wins or zero spend into a paid-Meta revenue claim", () => {
  const unattributed = buildCrmMetrics(input({
    contacts: [contact("c-unattributed-won")],
    opportunities: [opportunity("o-unattributed-won", { contactId: "c-unattributed-won", semanticStage: "wonCustomer", status: "won", valueMajorUnits: 100 })],
  }));
  assert.equal(unattributed.revenue.minorUnits, null);
  assert.equal(unattributed.revenue.status, "unknown");
  assert.equal(unattributed.revenue.roas, null);
  assert.equal(unattributed.attributionBreakdown.find((row) => row.granularity === "unattributed").attributedRevenueMinorUnits, null);

  const zeroSpend = buildCrmMetrics(input({
    meta: { ...input().meta, spendMinorUnits: 0 },
    contacts: [contact("c-paid", { attributionGranularity: "paid-meta" })],
    opportunities: [opportunity("o-paid", { contactId: "c-paid", semanticStage: "wonCustomer", status: "won", valueMajorUnits: 100 })],
  }));
  assert.equal(zeroSpend.revenue.status, "complete");
  assert.equal(zeroSpend.revenue.minorUnits, 10_000);
  assert.equal(zeroSpend.revenue.roas, null);
});

test("keeps missing cohort dates unknown instead of manufacturing zeroes", () => {
  const result = buildCrmMetrics(input({ contacts: [contact("no-date", { dateAdded: null, attributionGranularity: "paid-meta" })] }));
  assert.equal(result.dataQuality, "unknown");
  assert.equal(result.counts.crmRecords, null);
  assert.equal(result.counts.metaLeads, 10);
  assert.match(result.warnings[0], /no usable creation date/);
});

test("uses terminal lost and won outcomes without counting earlier stages as separate records", () => {
  const result = buildCrmMetrics(input({
    contacts: [contact("c-terminal", { attributionGranularity: "paid-meta" })],
    opportunities: [
      opportunity("o-qualified", { contactId: "c-terminal", semanticStage: "qualified" }),
      opportunity("o-lost", { contactId: "c-terminal", semanticStage: "lost", status: "lost", updatedAtProvider: "2026-09-05T10:00:00.000Z" }),
    ],
  }));
  assert.equal(result.counts.lostCustomers, 1);
  assert.equal(result.counts.qualified, 0);
});
