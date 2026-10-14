import test from "node:test";
import assert from "node:assert/strict";
import { ownedAcquisitionCatalogue } from "../lib/acquisition-catalogue.ts";

const accountId = "act_123456789";
const runs = [{ id: "own", accountId, campaignId: null, attributionKey: "7d_click", status: "SUCCEEDED", finishedAt: new Date() }, { id: "foreign", accountId: "act_987654321", campaignId: null, attributionKey: "7d_click", status: "SUCCEEDED", finishedAt: new Date() }];
const ad = (metaId, lastSeenSyncRunId) => ({ metaId, lastSeenSyncRunId, adSetMetaId: "222222222", campaignMetaId: "333333333" });
const row = (entityId, syncRunId, values = {}) => ({ entityId, syncRunId, level: "ad", scopeKey: "account", attributionKey: "7d_click", raw: JSON.stringify({ account_id: "123456789", ad_id: entityId, adset_id: "222222222", campaign_id: "333333333", ...values }) });

test("only completed account-owned metadata or receipts can establish advert ownership", () => {
  const result = ownedAcquisitionCatalogue({ accountId, runs, ads: [ad("111111111", "own"), ad("444444444", "foreign")], history: [row("555555555", "own"), row("666666666", "foreign"), row("777777777", "own", { account_id: "987654321" })], adSets: [{ metaId: "222222222", lastSeenSyncRunId: "own" }, { metaId: "888888888", lastSeenSyncRunId: "foreign" }] });
  assert.deepEqual(result.identities.map(a => a.adId).sort(), ["111111111", "555555555"]);
  assert.deepEqual(result.ads.map(a => a.metaId), ["111111111"]); assert.deepEqual(result.adSets.map(a => a.metaId), ["222222222"]);
});

test("contradictory account-owned historical hierarchies cannot be resolved by row order", () => {
  const result = ownedAcquisitionCatalogue({ accountId, runs, ads: [ad("111111111", "own")], history: [row("111111111", "own", { adset_id: "555555555", campaign_id: "666666666" })] });
  assert.equal(result.identities.length, 0); assert.equal(result.ads.length, 0);
});
