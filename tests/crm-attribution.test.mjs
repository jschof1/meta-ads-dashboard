import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContact, normalizeOpportunity, validatePipelineMapping } from "../lib/crm-attribution.ts";
import { loadHighLevelSettings } from "../lib/highlevel-config.ts";

function config(overrides = {}) {
  return loadHighLevelSettings({
    HIGHLEVEL_TOKEN: "token",
    HIGHLEVEL_LOCATION_ID: "location-1",
    HIGHLEVEL_SYNC_ENABLED: "true",
    HIGHLEVEL_PIPELINE_ID: "pipeline-1",
    HIGHLEVEL_STAGE_LEAD_ID: "stage-lead",
    HIGHLEVEL_STAGE_CONTACTED_ID: "stage-contacted",
    HIGHLEVEL_STAGE_QUALIFIED_ID: "stage-qualified",
    HIGHLEVEL_STAGE_CALL_BOOKED_ID: "stage-booked",
    HIGHLEVEL_STAGE_CALL_ATTENDED_ID: "stage-attended",
    HIGHLEVEL_WON_STATUS: "won",
    HIGHLEVEL_LOST_STATUS: "lost",
    HIGHLEVEL_CURRENCY_CODE: "GBP",
    HIGHLEVEL_META_AD_ID_FIELD_ID: "field-meta-ad",
    HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "field-meta-campaign",
    ...overrides,
  });
}

test("extracts bounded attribution and explicit custom-field Meta ids without storing an email", () => {
  const result = normalizeContact({
    id: "contact-1",
    locationId: "location-1",
    email: "Lead@Example.test",
    dateAdded: "2026-09-04T10:00:00.000Z",
    customFields: [
      { id: "field-meta-ad", value: "ad-123" },
      { id: "field-meta-campaign", value: "campaign-456" },
    ],
    attributionSource: {
      utmSource: "meta",
      utmMedium: "paid_social",
      utmCampaign: "spring-leads",
      utmContent: "hook-a",
      fbclid: "fb-click",
      fbc: "fb-cookie",
      fbp: "browser-cookie",
      fbEventId: "event-1",
      referrer: "https://example.test/landing",
    },
  }, config());

  assert.equal(result.attributionGranularity, "ad");
  assert.equal(result.metaAdId, "ad-123");
  assert.equal(result.metaCampaignId, "campaign-456");
  assert.equal(result.utmSource, "meta");
  assert.equal(result.utmMedium, "paid_social");
  assert.equal(result.utmCampaign, "spring-leads");
  assert.deepEqual(result.clickIds, { fbclid: "fb-click", fbc: "fb-cookie", fbp: "browser-cookie", fbEventId: "event-1" });
  assert.equal(JSON.stringify(result).includes("Lead@Example.test"), false);
});

test("uses honest granularity and never promotes arbitrary campaign or UTM names to Meta ids", () => {
  const campaign = normalizeContact({ id: "contact-campaign", locationId: "location-1", customFields: [{ id: "field-meta-campaign", value: "campaign-explicit" }], attribution: { source: "newsletter", medium: "email", campaign: "name-only" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "field-meta-campaign" }));
  assert.equal(campaign.attributionGranularity, "campaign");
  assert.equal(campaign.metaCampaignId, "campaign-explicit");

  const paid = normalizeContact({ id: "contact-paid", locationId: "location-1", attribution: { source: "meta", medium: "paid_social", campaign: "name-only" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "" }));
  assert.equal(paid.attributionGranularity, "paid-meta");
  assert.equal(paid.metaCampaignId, null);

  const organicMeta = normalizeContact({ id: "contact-organic", locationId: "location-1", attribution: { source: "meta", medium: "organic" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "" }));
  assert.equal(organicMeta.attributionGranularity, "unattributed");

  const nonMetaPaid = normalizeContact({ id: "contact-google", locationId: "location-1", attribution: { source: "google", medium: "paid_social" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "" }));
  assert.equal(nonMetaPaid.attributionGranularity, "unattributed");

  const standardMeta = normalizeContact({ id: "contact-standard-meta", locationId: "location-1", attribution: { utm_source: "fb_ad", utm_medium: "cpc", campaign_id: "campaign-standard" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "" }));
  assert.equal(standardMeta.attributionGranularity, "campaign");
  assert.equal(standardMeta.metaCampaignId, "campaign-standard");

  const unknown = normalizeContact({ id: "contact-unknown", locationId: "location-1", attribution: { source: "newsletter", medium: "email" } }, config({ HIGHLEVEL_META_AD_ID_FIELD_ID: "", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "" }));
  assert.equal(unknown.attributionGranularity, "unattributed");
});

test("maps only exact configured HighLevel statuses and stage ids", () => {
  const current = config();
  assert.equal(normalizeOpportunity({ id: "opp-lead", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-lead", status: "open", contactId: "contact-1", monetaryValue: "12.50" }, current).semanticStage, "lead");
  assert.equal(normalizeOpportunity({ id: "opp-won", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "some-unknown-stage", status: "won", contactId: "contact-1", monetaryValue: 99 }, current).semanticStage, "wonCustomer");
  assert.equal(normalizeOpportunity({ id: "opp-name", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-qualified", status: "open", name: "Won" }, current).semanticStage, "qualified");
  assert.equal(normalizeOpportunity({ id: "opp-bad", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-qualified", status: "WON" }, current).semanticStage, null);
  assert.equal(normalizeOpportunity({ id: "opp-abandoned", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-qualified", status: "abandoned" }, current).semanticStage, null);
  assert.equal(normalizeOpportunity({ id: "opp-negative", locationId: "location-1", pipelineId: "pipeline-1", pipelineStageId: "stage-qualified", status: "open", monetaryValue: -1 }, current).valueMajorUnits, null);
  assert.equal(normalizeOpportunity({ id: "opp-other-pipeline", locationId: "location-1", pipelineId: "other", pipelineStageId: "stage-qualified", status: "open" }, current), null);
  assert.equal(normalizeOpportunity({ id: "opp-no-scope", pipelineStageId: "stage-qualified", status: "open" }, current), null);
  assert.equal(normalizeContact({ id: "contact-no-scope" }, current), null);
  assert.equal(normalizeContact({ id: "contact-invalid-date", locationId: "location-1", dateAdded: "2026-02-30" }, current).dateAdded, null);
});

test("requires every configured stage to exist in the confirmed pipeline", () => {
  const errors = validatePipelineMapping({
    id: "pipeline-1",
    locationId: "location-1",
    stages: [{ id: "stage-lead" }, { id: "stage-contacted" }, { id: "stage-qualified" }, { id: "stage-booked" }],
  }, config());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /callAttended/);
});
