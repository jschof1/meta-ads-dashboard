import test from "node:test";
import assert from "node:assert/strict";
import { preserveAttribution, readAttributionTouch, resolveCustomerIdentities } from "../lib/acquisition-attribution.ts";
import { normalizeCustomerJourney, UKTL_LOCATION, UKTL_STRIPE_ACCOUNT } from "../lib/customer-journey.ts";
import { acquisitionQuery, buildAcquisitionReport, cohortMetrics } from "../lib/acquisition-report.ts";
import { readStripeSnapshot } from "../lib/stripe-read.ts";

const identities = [{ adId: "111111111", adSetId: "222222222", campaignId: "333333333" }];
const touch = { utmSource: "fb_ad", adId: "111111111", campaign_id: "333333333" };
const metadata = { altId: UKTL_LOCATION, contactId: "contact1" };
function fixture() {
  return {
    locationId: UKTL_LOCATION, formId: "form1", pipelineId: "pipeline1", calendarSince: "2026-01-01", identities,
    contacts: [{ id: "contact1", locationId: UKTL_LOCATION, dateAdded: "2026-02-01T12:00:00Z", email: "private@example.test", phone: "private", tags: [], attributionSource: { ...touch, medium: "form", mediumId: "form1", fbclid: "secret-click", ip: "secret-ip", url: "https://example.test/?email=private" } }],
    opportunities: [{ id: "opp1", pipelineId: "pipeline1", contactId: "contact1", status: "won" }],
    events: [{ id: "event1", contactId: "contact1", appointmentStatus: "showed" }], payments: [],
    stripe: { accountId: UKTL_STRIPE_ACCOUNT, livemode: true, complete: true, checkedAt: "2026-10-14T12:00:00Z",
      customers: [{ id: "cus_one", livemode: true, metadata }],
      charges: [{ id: "ch_one", livemode: true, customer: "cus_one", payment_intent: "pi_one", status: "succeeded", paid: true, captured: true, amount: 19700, amount_captured: 19700, amount_refunded: 0, currency: "gbp", created: 1770033600, metadata }],
      subscriptions: [{ id: "sub_one", livemode: true, customer: "cus_one", status: "active", start_date: 1770033600, ended_at: null, cancel_at_period_end: false, metadata }],
    },
  };
}

test("stable account-owned IDs establish hierarchy; names, other accounts and Google IDs do not", () => {
  assert.equal(readAttributionTouch(touch, identities).adSetId, "222222222");
  assert.equal(readAttributionTouch({ utmSource: "fb_ad", utmContent: "111111111" }, identities).adId, null);
  assert.equal(readAttributionTouch({ ...touch, adId: "999999999" }, identities).adId, null);
  assert.equal(readAttributionTouch({ ...touch, campaign_id: "999999999" }, identities).adId, null);
  assert.equal(readAttributionTouch({ ...touch, utmSource: "google" }, identities).adId, null);
  assert.equal(readAttributionTouch({ utmSource: "facebook", gclid: "google-id" }, identities).paidMeta, false);
  assert.equal(readAttributionTouch({ url: "https://example.test/?utm_source=fb_ad&ad_id=111111111&adset_id=222222222&campaign_id=333333333" }, identities).adId, "111111111");
  assert.equal(readAttributionTouch({ utmSource: "fb_ad", campaign: "333333333" }, identities).campaignId, "333333333");
});

test("first-touch survives return visits, absent provider fields and conflicting rewrites", () => {
  const first = preserveAttribution({ attributionSource: touch }, identities);
  const next = preserveAttribution({ attributionSource: { utmSource: "google" }, lastAttributionSource: { utmSource: "google" } }, identities, first);
  assert.equal(next.first.adId, "111111111"); assert.equal(next.latest.source, "google"); assert.equal(next.firstConflict, true);
  assert.equal(preserveAttribution({}, identities, next).first.adId, "111111111");
  const organic = preserveAttribution({ attributionSource: { utmSource: "google" } }, identities);
  assert.equal(preserveAttribution({ attributionSource: touch }, identities, organic).first.source, "google");
  const direct = preserveAttribution({ attributionSource: { sessionSource: "Direct traffic" } }, identities);
  assert.equal(preserveAttribution({ attributionSource: touch }, identities, direct).first.source, "direct traffic");
});

test("ambiguous customer/contact identities stay unresolved", () => {
  const { matched, ambiguous } = resolveCustomerIdentities([
    { customerId: "cus_one", contactId: "c1", evidence: "stripe_metadata" },
    { customerId: "cus_one", contactId: "c2", evidence: "ghl_payment_id" },
  ], new Set(["c1", "c2"]));
  assert.equal(matched.size, 0); assert.equal(ambiguous.size, 1);
});

test("full synthetic ad-to-CRM-to-payment journey uses IDs and stores no private details", () => {
  const snapshot = normalizeCustomerJourney(fixture());
  assert.equal(snapshot.contacts[0].attribution.first.adId, "111111111");
  assert.equal(snapshot.contacts[0].attended, true); assert.equal(snapshot.contacts[0].won, true);
  assert.equal(snapshot.charges[0].contactId, "contact1");
  assert.equal(snapshot.contacts[0].qualified, null);
  for (const secret of ["private@example.test", "secret-click", "secret-ip", "https://example.test"]) assert.equal(JSON.stringify(snapshot).includes(secret), false);
  const c = cohortMetrics(snapshot, new Set(["contact1"]), 10000, "2026-02-28");
  assert.equal(c.payingCustomers, 1); assert.equal(c.collected, 19700); assert.equal(c.costPerCustomer, 10000);
  assert.equal(c.active, 1); assert.equal(c.churned, 0); assert.equal(c.eligible90, 1); assert.equal(c.retained90, 1);
});

test("repeat payments, authorisation reversals and full refunds do not create extra customers", () => {
  const input = fixture();
  input.stripe.charges[0].amount_refunded = 19700;
  input.stripe.charges.push({ ...input.stripe.charges[0], id: "ch_two", amount_refunded: 0 });
  input.stripe.charges.push({ ...input.stripe.charges[0], id: "ch_auth", captured: false, amount: 100, amount_captured: 0, amount_refunded: 100 });
  const c = cohortMetrics(normalizeCustomerJourney(input), new Set(["contact1"]), 10000, "2026-02-28");
  assert.equal(c.payingCustomers, 1); assert.equal(c.collected, 39400); assert.equal(c.refunded, 19700); assert.equal(c.net, 19700);
});

test("GHL payment-intent IDs safely join Stripe charges without matching names or dates", () => {
  const input = fixture();
  for (const r of [...input.stripe.customers, ...input.stripe.charges, ...input.stripe.subscriptions]) r.metadata = {};
  input.payments.push({ _id: "receipt", altId: UKTL_LOCATION, paymentProviderConnectedAccount: UKTL_STRIPE_ACCOUNT, liveMode: true, paymentProviderType: "stripe", chargeId: "pi_one", contactId: "contact1" });
  assert.equal(normalizeCustomerJourney(input).charges[0].contactId, "contact1");
  input.payments[0].paymentProviderConnectedAccount = "wrong-account";
  assert.equal(normalizeCustomerJourney(input).charges[0].contactId, null);
});

test("test records and wrong accounts fail closed; duplicate charge IDs cannot double-count", () => {
  const input = fixture(); input.contacts[0].tags = ["uktl-tracking-test"];
  assert.equal(normalizeCustomerJourney(input).contacts.length, 0);
  input.stripe.accountId = "other"; assert.throws(() => normalizeCustomerJourney(input), /scope/);
  const duplicate = fixture(); duplicate.stripe.charges.push(duplicate.stripe.charges[0]);
  assert.throws(() => normalizeCustomerJourney(duplicate), /duplicate/);
  const incomplete = fixture(); incomplete.stripe.complete = false;
  assert.throws(() => normalizeCustomerJourney(incomplete), /complete/);
});

test("booked is not attended; scheduled cancellations are not churn; young cohorts are censored", () => {
  const input = fixture(); input.events[0].appointmentStatus = "confirmed";
  input.stripe.subscriptions[0].cancel_at_period_end = true;
  input.stripe.subscriptions[0].canceled_at = 1770033600;
  input.stripe.checkedAt = "2026-02-10T12:00:00Z";
  const snapshot = normalizeCustomerJourney(input), c = cohortMetrics(snapshot, new Set(["contact1"]), 10000, "2026-02-28");
  assert.equal(c.booked, 1); assert.equal(c.attended, 0); assert.equal(c.churned, 0); assert.equal(c.cancellationScheduled, 1);
  assert.equal(c.eligible30, 0); assert.equal(c.eligible90, 0);
});

test("replacement subscriptions prevent false churn and qualification requires exact explicit mapping", () => {
  const input = fixture(); input.qualifiedStageIds = ["verified-stage"];
  input.opportunities[0].pipelineStageId = "verified-stage";
  input.stripe.subscriptions[0].status = "canceled"; input.stripe.subscriptions[0].ended_at = 1772452800;
  input.stripe.subscriptions.push({ ...input.stripe.subscriptions[0], id: "sub_replacement", status: "active", ended_at: null, start_date: 1772452800 });
  const s = normalizeCustomerJourney(input); assert.equal(s.contacts[0].qualified, true);
  const c = cohortMetrics(s, new Set(["contact1"]), 10000, "2026-02-28"); assert.equal(c.churned, 0); assert.equal(c.retained90, 1);
});

const insight = (date, values = {}) => ({ date, level: "ad", entityId: "111111111", spendMinorUnits: 10000, impressions: 2000, clicks: 100, linkClicks: 50, leads: 10, frequency: 1.5, reach: 1333, ...values });
const run = { requestedSince: "2026-01-01", requestedUntil: "2026-10-13", finishedAt: new Date("2026-10-14T06:00:00Z") };
test("comparisons aggregate numerators, avoid cross-day reach sums and expose sparse historical coverage", () => {
  const query = acquisitionQuery(new URLSearchParams({ since: "2026-02-01", until: "2026-02-28", compareSince: "2026-03-01", compareUntil: "2026-03-31" }), new Date("2026-10-14"));
  const report = buildAcquisitionReport({ query, insights: [insight("2026-02-01"), insight("2026-02-02", { spendMinorUnits: 20000, impressions: 8000 })], runs: [run], journey: normalizeCustomerJourney(fixture()), names: new Map() });
  assert.equal(report.rows[0].current.metrics.cplCents, 1500);
  assert.equal(report.rows[0].current.metrics.ctrLink, 100 / 10000);
  assert.equal(report.rows[0].current.dailyReach, null);
  assert.equal(report.rows[0].current.customers.payingCustomers, 1);
  assert.match(report.rows[0].recommendation, /Insufficient evidence/);
  const incomplete = buildAcquisitionReport({ query, insights: [insight("2026-02-01")], runs: [], journey: null, names: new Map() });
  assert.equal(incomplete.rows[0].current.metrics.spendCents, null); assert.equal(incomplete.rows[0].current.customers, null);
});

test("invalid dates, future dates and unsupported dimensions are rejected", () => {
  for (const params of [{ since: "2026-02-30", until: "2026-03-01" }, { since: "2025-01-01" }, { until: "2099-01-01" }, { level: "account" }, { touch: "name" }]) assert.throws(() => acquisitionQuery(new URLSearchParams(params), new Date("2026-10-14")));
});

test("Stripe adapter checks the exact live account before paginated GET-only reads", async () => {
  const seen = [];
  const result = await readStripeSnapshot({ token: "rk_live_fixture", sleep: async () => {}, fetcher: async (url, init) => {
    seen.push({ url, init });
    const path = new URL(url).pathname;
    if (path === "/v1/account") return Response.json({ id: UKTL_STRIPE_ACCOUNT });
    if (path === "/v1/charges" && !new URL(url).searchParams.has("starting_after")) return Response.json({ data: [{ id: "ch_one", livemode: true }], has_more: true });
    return Response.json({ data: [], has_more: false });
  } });
  assert.equal(result.charges.length, 1); assert.ok(seen.some(r => r.url.includes("starting_after=ch_one")));
  assert.ok(seen.every(r => r.init.method === "GET"));
  let calls = 0;
  await assert.rejects(() => readStripeSnapshot({ token: "rk_live_fixture", fetcher: async () => { calls++; return Response.json({ id: "other" }); } }), /mismatch/);
  assert.equal(calls, 1);
});

test("Stripe rate limits use Retry-After, reject excessive waits and never expose tokens", async () => {
  const waits = []; let attempts = 0;
  await assert.rejects(() => readStripeSnapshot({ token: "rk_live_fixture", sleep: async ms => waits.push(ms), fetcher: async () => { attempts++; return Response.json({}, { status: 429, headers: { "Retry-After": "2" } }); } }), /429/);
  assert.equal(attempts, 3); assert.deepEqual(waits, [2100, 2100]);
  await assert.rejects(() => readStripeSnapshot({ token: "rk_live_fixture", fetcher: async () => Response.json({}, { status: 429, headers: { "Retry-After": "60" } }) }), /429/);
});
