// Only stable provider identifiers establish attribution. Names and dates never do.
export type AttributionTouch = {
  source: string | null;
  medium: string | null;
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  paidMeta: boolean;
};
export type AttributionPair = { first: AttributionTouch; latest: AttributionTouch; firstConflict: boolean };
export type MetaIdentity = { adId: string; adSetId: string | null; campaignId: string | null };
type Row = Record<string, unknown>;
export const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
export const boundedText = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : null;
const metaId = (v: unknown) => /^\d{6,32}$/.test(String(v ?? "")) ? String(v) : null;
const empty = (): AttributionTouch => ({ source: null, medium: null, campaignId: null, adSetId: null, adId: null, paidMeta: false });

export function readAttributionTouch(value: unknown, identities: MetaIdentity[]): AttributionTouch {
  const row = object(value);
  let query = new URLSearchParams();
  try {
    const url = new URL(String(row.url ?? row.landingPage ?? ""));
    if (url.protocol === "https:" || url.protocol === "http:") query = url.searchParams;
  } catch { /* URL is optional. Never persist it or its click IDs. */ }
  const get = (...keys: string[]) => keys.map(k => row[k] ?? query.get(k)).find(v => boundedText(v));
  const source = boundedText(get("utmSource", "utm_source", "source", "sessionSource"))?.toLowerCase() ?? null;
  const medium = boundedText(get("utmMedium", "utm_medium", "medium"));
  let campaignId = metaId(get("metaCampaignId", "facebookCampaignId", "campaignId", "campaign_id", "campaign"));
  let adSetId = metaId(get("metaAdSetId", "adSetId", "adsetId", "adset_id"));
  let adId = metaId(get("metaAdId", "facebookAdId", "adId", "ad_id", "h_ad_id"));
  const metaSource = ["fb_ad", "meta", "meta_ads", "facebook_ads", "instagram_ads", "facebook", "instagram", "fb", "ig"].includes(source ?? "");
  const explicitPaid = ["fb_ad", "meta_ads", "facebook_ads", "instagram_ads"].includes(source ?? "");
  // A Google click id or browser cookie alone cannot prove a paid Meta visit.
  const paidMeta = explicitPaid || (metaSource && Boolean(row.fbclid || query.get("fbclid") || /^(paid[_-]?social|cpc|ppc)$/i.test(medium ?? "")));
  const identity = identities.find(a => a.adId === adId);
  if (identity && (!campaignId || campaignId === identity.campaignId) && (!adSetId || adSetId === identity.adSetId)) {
    campaignId = identity.campaignId;
    adSetId = identity.adSetId;
  } else adId = null;
  if (adSetId && !identities.some(a => a.adSetId === adSetId && (!campaignId || a.campaignId === campaignId))) adSetId = null;
  if (campaignId && !identities.some(a => a.campaignId === campaignId)) campaignId = null;
  // Explicit IDs must belong to this account. Cross-channel generic IDs fail closed.
  if (source && !metaSource) { adId = null; adSetId = null; campaignId = null; }
  return { source, medium, campaignId, adSetId, adId, paidMeta: paidMeta || Boolean(adId || adSetId || campaignId) };
}

export function preserveAttribution(raw: Row, identities: MetaIdentity[], previous?: AttributionPair): AttributionPair {
  const first = readAttributionTouch(raw.attributionSource ?? raw.attribution_source, identities);
  const latestValue = raw.lastAttributionSource ?? raw.latestAttributionSource;
  const latest = latestValue ? readAttributionTouch(latestValue, identities) : previous?.latest ?? first;
  // A missing first touch is different from a known organic/direct first touch.
  const hasFirst = (t: AttributionTouch) => Boolean(t.source || t.medium || t.adId || t.campaignId);
  const original = previous && hasFirst(previous.first) ? previous.first : first;
  const firstConflict = Boolean(previous?.firstConflict || (previous && hasFirst(previous.first) && hasFirst(first)
    && JSON.stringify(previous.first) !== JSON.stringify(first)));
  return { first: hasFirst(original) ? original : empty(), latest, firstConflict };
}

export type IdentityEvidence = { customerId: string; contactId: string; evidence: "stripe_metadata" | "ghl_payment_id" };
export function resolveCustomerIdentities(evidence: IdentityEvidence[], contactIds: Set<string>) {
  const byCustomer = new Map<string, Set<string>>();
  for (const row of evidence) {
    if (!/^cus_[A-Za-z0-9]+$/.test(row.customerId) || !contactIds.has(row.contactId)) continue;
    const ids = byCustomer.get(row.customerId) ?? new Set<string>();
    ids.add(row.contactId); byCustomer.set(row.customerId, ids);
  }
  const matched = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [customerId, ids] of byCustomer) {
    if (ids.size === 1) matched.set(customerId, [...ids][0]);
    else ambiguous.add(customerId);
  }
  return { matched, ambiguous };
}
