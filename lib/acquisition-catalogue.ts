import type { Ad, AdSet, Campaign, DailyInsight, SyncRun } from "@prisma/client";
import type { MetaIdentity } from "./acquisition-attribution";

/** Metadata tables outlive account changes. Only a completed run in the
 * intended account can establish ownership; global numeric IDs are not enough.
 */
export function ownedAcquisitionCatalogue(input: {
  accountId: string; runs: SyncRun[]; history: DailyInsight[];
  ads: Ad[]; adSets?: AdSet[]; campaigns?: Campaign[];
}) {
  const accountId = input.accountId.replace(/^act_/, "");
  const runs = new Map(input.runs.filter(r => r.status === "SUCCEEDED" && r.finishedAt && r.accountId === `act_${accountId}` && r.campaignId == null).map(r => [r.id, r]));
  const ownedAds = input.ads.filter(ad => ad.lastSeenSyncRunId && runs.has(ad.lastSeenSyncRunId));
  const candidates = new Map<string, Map<string, MetaIdentity>>();
  function add(identity: MetaIdentity) {
    if (!/^\d{6,32}$/.test(identity.adId) || !/^\d{6,32}$/.test(identity.adSetId ?? "") || !/^\d{6,32}$/.test(identity.campaignId ?? "")) return;
    const values = candidates.get(identity.adId) ?? new Map<string, MetaIdentity>();
    values.set(JSON.stringify(identity), identity); candidates.set(identity.adId, values);
  }
  for (const ad of ownedAds) add({ adId: ad.metaId, adSetId: ad.adSetMetaId, campaignId: ad.campaignMetaId });
  for (const row of input.history) {
    const run = runs.get(row.syncRunId);
    if (!run || row.level !== "ad" || row.scopeKey !== "account" || row.attributionKey !== run.attributionKey) continue;
    try {
      const raw = JSON.parse(row.raw);
      if (raw.account_id && String(raw.account_id).replace(/^act_/, "") !== accountId) continue;
      if (raw.ad_id !== row.entityId) continue;
      add({ adId: row.entityId, adSetId: raw.adset_id ?? null, campaignId: raw.campaign_id ?? null });
    } catch { /* Malformed receipts cannot establish account ownership. */ }
  }
  // Conflicting historical hierarchy evidence is never resolved by row order.
  const identities = [...candidates.values()].filter(values => values.size === 1).map(values => [...values.values()][0]);
  const adIds = new Set(identities.map(a => a.adId));
  const adSetIds = new Set(identities.map(a => a.adSetId));
  const campaignIds = new Set(identities.map(a => a.campaignId));
  return {
    identities,
    ads: input.ads.filter(a => adIds.has(a.metaId) && (!a.lastSeenSyncRunId || runs.has(a.lastSeenSyncRunId))),
    adSets: (input.adSets ?? []).filter(a => (adSetIds.has(a.metaId) || (a.lastSeenSyncRunId && runs.has(a.lastSeenSyncRunId))) && (!a.lastSeenSyncRunId || runs.has(a.lastSeenSyncRunId))),
    campaigns: (input.campaigns ?? []).filter(a => (campaignIds.has(a.metaId) || (a.lastSeenSyncRunId && runs.has(a.lastSeenSyncRunId))) && (!a.lastSeenSyncRunId || runs.has(a.lastSeenSyncRunId))),
  };
}
