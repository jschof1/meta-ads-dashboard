import test from "node:test";
import assert from "node:assert/strict";
import {
  createMetaClient,
  diagnoseResultEvents,
  extractRegistrations,
  extractResultEvents,
  MetaApiError,
  MetaConfigurationError,
  MetaPaginationError,
  MetaResultEventError,
} from "../lib/meta.ts";
import { MetaWritesDisabledError, pauseAd, setAdsetBudget } from "../lib/meta-writes.ts";

const token = "meta-test-token-that-must-never-appear-in-a-url";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function makeClient(handler, options = {}) {
  const calls = [];
  const sleeps = [];
  const client = createMetaClient({
    token,
    adAccountId: "act_123",
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return handler(new URL(url), init, calls);
    },
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    random: () => 0,
    ...options,
  });
  return { client, calls, sleeps };
}

test("uses the configured graph version, bearer auth, account-wide paths and cursor pagination", async () => {
  const { client, calls } = makeClient((url) => {
    const after = url.searchParams.get("after");
    if (!after) {
      return jsonResponse({
        data: Array.from({ length: 50 }, (_, index) => ({ id: `ad-${index}`, name: `Ad ${index}` })),
        paging: { cursors: { after: "cursor-1" } },
      });
    }
    return jsonResponse({ data: [{ id: "ad-50", name: "Ad 50" }] });
  }, { graphVersion: "v24.0", pageSize: 50 });

  const ads = await client.listAds();

  assert.equal(ads.length, 51);
  assert.equal(calls[0].url.pathname, "/v24.0/act_123/ads");
  assert.equal(calls[0].url.searchParams.get("limit"), "50");
  assert.equal(calls[1].url.searchParams.get("after"), "cursor-1");
  assert.equal(calls.every(({ url }) => !url.toString().includes(token)), true);
  assert.equal(calls.every(({ init }) => init.headers.Authorization === `Bearer ${token}`), true);
  assert.equal(calls.every(({ init }) => init.method === "GET"), true);
});

test("uses a safe cursor from paging.next without replaying its access token", async () => {
  const { client, calls } = makeClient((url) => {
    if (!url.searchParams.has("after")) {
      return jsonResponse({
        data: [{ id: "c1" }],
        paging: { next: `https://graph.facebook.com/v25.0/act_123/campaigns?after=next-cursor&access_token=${token}` },
      });
    }
    return jsonResponse({ data: [{ id: "c2" }] });
  });

  assert.deepEqual((await client.listCampaigns()).map((campaign) => campaign.id), ["c1", "c2"]);
  assert.equal(calls[1].url.searchParams.get("after"), "next-cursor");
  assert.equal(calls[1].url.searchParams.has("access_token"), false);
  assert.equal(calls.every(({ url }) => !url.toString().includes(token)), true);
});

test("discovers account context and all entity types without a campaign id", async () => {
  const { client, calls } = makeClient((url) => {
    const path = url.pathname;
    if (path.endsWith("/act_123")) {
      return jsonResponse({ id: "act_123", name: "UKTL", currency: "GBP", timezone_name: "Europe/London" });
    }
    if (path.endsWith("/campaigns")) return jsonResponse({ data: [{ id: "campaign-1", name: "Leads" }] });
    if (path.endsWith("/adsets")) return jsonResponse({ data: [{ id: "adset-1", campaign_id: "campaign-1", learning_stage_info: { status: "LEARNING" } }] });
    if (path.endsWith("/ads")) return jsonResponse({ data: [{ id: "ad-1", name: "Creative", status: "ACTIVE", effective_status: "ACTIVE", adset_id: "adset-1", creative: { id: "creative-1" } }] });
    if (path.endsWith("/adcreatives")) return jsonResponse({ data: [{ id: "creative-1", title: "A lead ad", body: "Book a call" }] });
    throw new Error(`unexpected path ${path}`);
  });

  const discovered = await client.discoverEntities();

  assert.equal(discovered.account.currency, "GBP");
  assert.equal(discovered.account.timezone_name, "Europe/London");
  assert.equal(discovered.campaigns.length, 1);
  assert.equal(discovered.adSets[0].learning_stage_info.status, "LEARNING");
  assert.equal(discovered.ads[0].creative_id, "creative-1");
  assert.equal(discovered.creatives[0].body, "Book a call");
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/act_123/adsets")), true);
  assert.equal(calls.some(({ url }) => url.pathname.endsWith("/act_123/ads")), true);
});

test("insights use explicit attribution and preserve account-wide operation when no campaign is configured", async () => {
  const { client, calls } = makeClient(() => jsonResponse({ data: [{ spend: "12.34", date_start: "2026-09-04" }] }));

  const rows = await client.getAdDaily("last_7d");
  const url = calls[0].url;

  assert.equal(rows[0].spend, "12.34");
  assert.equal(url.pathname, "/v25.0/act_123/insights");
  assert.equal(url.searchParams.get("level"), "ad");
  assert.equal(url.searchParams.get("time_increment"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("action_attribution_windows")), ["7d_click", "1d_view"]);
  assert.equal(url.searchParams.get("action_report_time"), "conversion");
  assert.equal(url.searchParams.has("filtering"), false);
  assert.deepEqual(Object.keys(JSON.parse(url.searchParams.get("time_range"))), ["since", "until"]);
});

test("retries transient responses with bounded backoff and exposes trace diagnostics", async () => {
  let requestCount = 0;
  const { client, calls, sleeps } = makeClient(() => {
    requestCount += 1;
    if (requestCount === 1) return jsonResponse({ error: { message: "temporary outage", is_transient: true } }, 503, { "x-fb-trace-id": "trace-1" });
    return jsonResponse({ data: [{ id: "campaign-1" }] }, 200, { "x-fb-trace-id": "trace-2", "x-app-usage": '{"call_count":12}' });
  }, { maxRetries: 2, backoffMs: 10, backoffCapMs: 20 });

  const result = await client.request("act_123/campaigns", { fields: "id" });

  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [10]);
  assert.equal(result.diagnostics.attempts, 2);
  assert.equal(result.diagnostics.traceId, "trace-2");
  assert.equal(result.diagnostics.appUsage.call_count, 12);
});

test("honours Retry-After on rate limiting and returns a typed exhausted error", async () => {
  const { client, calls, sleeps } = makeClient(() => jsonResponse(
    { error: { message: "Application request limit reached", code: 4, fbtrace_id: "trace-rate" } },
    429,
    { "retry-after": "3", "x-ad-account-usage": '{"acc_id_util_pct":91}' },
  ), { maxRetries: 1, backoffMs: 1 });

  await assert.rejects(
    () => client.request("act_123/insights"),
    (error) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.kind, "rate_limit");
      assert.equal(error.status, 429);
      assert.equal(error.code, 4);
      assert.equal(error.diagnostics.attempts, 2);
      assert.equal(error.diagnostics.traceId, "trace-rate");
      assert.equal(error.diagnostics.adAccountUsage.acc_id_util_pct, 91);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(sleeps, [3000]);
});

test("does not retry expired or invalid tokens", async () => {
  const { client, calls, sleeps } = makeClient(() => jsonResponse(
    { error: { message: `Invalid OAuth access token ${token}`, code: 190, type: "OAuthException" } },
    400,
  ), { maxRetries: 2 });

  await assert.rejects(
    () => client.getAccount(),
    (error) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.kind, "auth");
      assert.equal(error.code, 190);
      assert.equal(error.message.includes(token), false);
      assert.equal(error.message.includes("[REDACTED]"), true);
      return true;
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test("rejects malformed collections, honours pagination item caps and accepts empty/partial data", async () => {
  const malformed = makeClient(() => jsonResponse({ data: { id: "not-a-list" } }));
  await assert.rejects(() => malformed.client.listCampaigns(), (error) => error instanceof MetaApiError && error.kind === "response");

  const capped = makeClient((url) => jsonResponse({ data: [{ id: url.searchParams.get("after") ?? "first" }], paging: { cursors: { after: `next-${url.searchParams.get("after") ?? "first"}` } } }), { maxPages: 2 });
  await assert.rejects(() => capped.client.listCampaigns(), MetaPaginationError);

  const itemCapped = makeClient(() => jsonResponse({ data: [{ id: "one" }, { id: "two" }] }), { maxItems: 1 });
  await assert.rejects(() => itemCapped.client.listCampaigns(), MetaPaginationError);

  const empty = makeClient(() => jsonResponse({ data: [] }));
  assert.deepEqual(await empty.client.listCampaigns(), []);

  const partial = makeClient(() => jsonResponse({ data: [{ id: "ad-1", status: "ACTIVE" }] }));
  const ads = await partial.client.listAds();
  assert.deepEqual(ads[0], { id: "ad-1", name: "ad-1", status: "ACTIVE", effective_status: "UNKNOWN", campaign_id: undefined, adset_id: undefined, creative_id: undefined, thumbnail_url: undefined });
});

test("diagnoses action types and requires explicit configuration for ambiguity", () => {
  const ambiguous = { actions: [
    { action_type: "offsite_conversion.fb_pixel_lead", value: "2" },
    { action_type: "offsite_conversion.custom.99", value: "3" },
    { action_type: "link_click", value: "12" },
  ] };
  const diagnostic = diagnoseResultEvents(ambiguous);
  assert.equal(diagnostic.ambiguous, true);
  assert.deepEqual(diagnostic.candidateActionTypes, ["offsite_conversion.fb_pixel_lead", "offsite_conversion.custom.99"]);
  assert.throws(() => extractResultEvents(ambiguous), MetaResultEventError);

  const selected = extractResultEvents(ambiguous, { primaryActionType: "offsite_conversion.custom.99" });
  assert.equal(selected.value, 3);
  assert.equal(selected.missing, false);
  assert.equal(extractRegistrations({ actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "4" }] }), 4);
  assert.equal(diagnoseResultEvents({ actions: [{ action_type: "link_click", value: "12" }] }).missing, true);
});

test("retries network failures and turns an aborted request into a safe timeout error", async () => {
  let attempts = 0;
  const network = makeClient(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("socket reset");
    return jsonResponse({ id: "act_123", name: "UKTL" });
  }, { maxRetries: 1, backoffMs: 5 });
  assert.equal((await network.client.getAccount()).name, "UKTL");
  assert.equal(network.sleeps.length, 1);

  const timeout = createMetaClient({
    token,
    adAccountId: "act_123",
    timeoutMs: 1,
    maxRetries: 0,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      void resolve;
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  await assert.rejects(() => timeout.getAccount(), (error) => {
    assert.ok(error instanceof MetaApiError);
    assert.match(error.message, /timed out/);
    assert.equal(error.kind, "transient");
    return true;
  });
});

test("fails closed when credentials are unavailable and disables every Meta write entry point", async () => {
  assert.throws(() => createMetaClient({ token: "", adAccountId: "act_123" }), MetaConfigurationError);
  assert.throws(() => createMetaClient({ token, adAccountId: "" }), MetaConfigurationError);
  await assert.rejects(() => pauseAd("ad-1"), MetaWritesDisabledError);
  await assert.rejects(() => setAdsetBudget("adset-1", 1000), MetaWritesDisabledError);
});
