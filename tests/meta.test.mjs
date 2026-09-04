import test from "node:test";
import assert from "node:assert/strict";
import {
  createMetaClient,
  diagnoseResultEvents,
  extractLeads,
  extractResultEvents,
  MetaApiError,
  MetaConfigurationError,
  MetaPaginationError,
  MetaResultEventError,
  toOptionalCents,
  toOptionalFloat,
  toOptionalInt,
} from "../lib/meta.ts";
import { MetaWritesDisabledError, pauseAd, setAdsetBudget } from "../lib/meta-writes.ts";
import { redactSensitiveData, safeJson } from "../lib/safe-json.ts";

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
        paging: { cursors: { after: "cursor-1" }, next: "https://graph.facebook.com/v24.0/act_123/ads?after=cursor-1" },
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

test("rejects an unsafe or incomplete paging.next instead of guessing a cursor", async () => {
  const unsafeHost = makeClient(() => jsonResponse({
    data: [{ id: "c1" }],
    paging: { next: "https://evil.example/campaigns?after=leaked" },
  }));
  await assert.rejects(() => unsafeHost.client.listCampaigns(), MetaPaginationError);

  const missingCursor = makeClient(() => jsonResponse({
    data: [{ id: "c1" }],
    paging: { next: "https://graph.facebook.com/v25.0/act_123/campaigns" },
  }));
  await assert.rejects(() => missingCursor.client.listCampaigns(), MetaPaginationError);
});

test("uses the official cursor when paging.next carries no query cursor", async () => {
  const { client, calls } = makeClient((url) => {
    if (!url.searchParams.has("after")) {
      return jsonResponse({
        data: [{ id: "c1" }],
        paging: {
          cursors: { after: "cursor-from-cursors" },
          next: "https://graph.facebook.com/v25.0/act_123/campaigns",
        },
      });
    }
    return jsonResponse({ data: [{ id: "c2" }] });
  });

  assert.deepEqual((await client.listCampaigns()).map((campaign) => campaign.id), ["c1", "c2"]);
  assert.equal(calls[1].url.searchParams.get("after"), "cursor-from-cursors");
});

test("stops on a terminal page when cursors remain but Meta omits paging.next", async () => {
  const { client, calls } = makeClient(() => jsonResponse({
    data: [{ id: "terminal" }],
    paging: { cursors: { before: "before", after: "stale-after" } },
  }));

  assert.deepEqual((await client.listCampaigns()).map((campaign) => campaign.id), ["terminal"]);
  assert.equal(calls.length, 1);
});

test("discovers account context and all entity types without a campaign id", async () => {
  const { client, calls } = makeClient((url) => {
    const path = url.pathname;
    if (path.endsWith("/act_123")) {
      return jsonResponse({ id: "act_123", name: "UKTL", currency: "GBP", timezone_name: "Europe/London" });
    }
    if (path.endsWith("/campaigns")) return jsonResponse({ data: [{ id: "campaign-1", name: "Leads" }] });
    if (path.endsWith("/adsets")) return jsonResponse({ data: [{ id: "adset-1", campaign_id: "campaign-1", learning_stage_info: { status: "LEARNING" } }] });
    if (path.endsWith("/ads")) return jsonResponse({ data: [{ id: "ad-1", name: "Creative", status: "ACTIVE", effective_status: "ACTIVE", adset_id: "adset-1", creative: { id: "creative-1", image_hash: "hash-1", video_id: "video-1", link_url: "https://example.test/book", object_story_spec: { link_data: { image_hash: "hash-1" } } } }] });
    if (path.endsWith("/adcreatives")) return jsonResponse({ data: [{ id: "creative-1", title: "A lead ad", body: "Book a call", image_hash: "hash-1", video_id: "video-1", object_url: "https://example.test/book", object_story_spec: { video_data: { video_id: "video-1" } } }] });
    throw new Error(`unexpected path ${path}`);
  });

  const discovered = await client.discoverEntities();

  assert.equal(discovered.account.currency, "GBP");
  assert.equal(discovered.account.timezone_name, "Europe/London");
  assert.equal(discovered.campaigns.length, 1);
  assert.equal(discovered.adSets[0].learning_stage_info.status, "LEARNING");
  assert.equal(discovered.ads[0].creative_id, "creative-1");
  assert.equal(discovered.ads[0].image_hash, "hash-1");
  assert.equal(discovered.ads[0].video_id, "video-1");
  assert.equal(discovered.ads[0].link_url, "https://example.test/book");
  assert.equal(discovered.ads[0].creative_raw.object_story_spec.link_data.image_hash, "hash-1");
  assert.equal(discovered.creatives[0].body, "Book a call");
  assert.equal(discovered.creatives[0].object_url, "https://example.test/book");
  assert.equal(discovered.creatives[0].raw.object_story_spec.video_data.video_id, "video-1");
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
  const history = client.getDiagnostics();
  assert.equal(history.requestCount, 2);
  assert.deepEqual(history.traceIds, ["trace-1", "trace-2"]);
  assert.deepEqual(history.statuses, [503, 200]);
});

test("treats a Graph error body as a failed response even when HTTP status is 200", async () => {
  const { client, calls } = makeClient(() => jsonResponse({
    error: { message: "Graph rejected the request", code: 100, error_subcode: 1487534, fbtrace_id: "trace-body-error" },
  }));

  await assert.rejects(
    () => client.getAccount(),
    (error) => {
      assert.ok(error instanceof MetaApiError);
      assert.equal(error.kind, "http");
      assert.equal(error.status, 200);
      assert.equal(error.code, 100);
      assert.equal(error.subcode, 1487534);
      assert.equal(error.traceId, "trace-body-error");
      return true;
    },
  );
  assert.equal(calls.length, 1);
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

test("caps an excessive Retry-After delay at the configured safety limit", async () => {
  const { client, sleeps } = makeClient(() => jsonResponse(
    { error: { message: "Application request limit reached", code: 4 } },
    429,
    { "retry-after": "30" },
  ), { maxRetries: 1, maxRetryAfterMs: 1_000 });

  await assert.rejects(() => client.request("act_123/insights"), MetaApiError);
  assert.deepEqual(sleeps, [1_000]);
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

  const capped = makeClient((url) => {
    const current = url.searchParams.get("after") ?? "first";
    return jsonResponse({
      data: [{ id: current }],
      paging: { cursors: { after: `ignored-${current}` }, next: `https://graph.facebook.com/v25.0/act_123/campaigns?after=next-${current}` },
    });
  }, { maxPages: 2 });
  await assert.rejects(() => capped.client.listCampaigns(), MetaPaginationError);

  const itemCapped = makeClient(() => jsonResponse({ data: [{ id: "one" }, { id: "two" }] }), { maxItems: 1 });
  await assert.rejects(() => itemCapped.client.listCampaigns(), MetaPaginationError);

  const empty = makeClient(() => jsonResponse({ data: [] }));
  assert.deepEqual(await empty.client.listCampaigns(), []);

  const partial = makeClient(() => jsonResponse({ data: [{ id: "ad-1", status: "ACTIVE" }] }));
  const ads = await partial.client.listAds();
  assert.equal(ads[0].id, "ad-1");
  assert.equal(ads[0].name, undefined);
  assert.equal(ads[0].status, "ACTIVE");
  assert.equal(ads[0].effective_status, undefined);
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
  assert.deepEqual(diagnostic.actionTypes, [
    { actionType: "offsite_conversion.fb_pixel_lead", count: 2 },
    { actionType: "offsite_conversion.custom.99", count: 3 },
    { actionType: "link_click", count: 12 },
  ]);
  assert.deepEqual(diagnostic.actionTypeCounts, {
    "offsite_conversion.fb_pixel_lead": 2,
    "offsite_conversion.custom.99": 3,
    link_click: 12,
  });
  assert.throws(() => extractResultEvents(ambiguous), MetaResultEventError);
  assert.throws(() => extractResultEvents({ actions: [{ action_type: "link_click", value: "12" }] }), (error) => {
    assert.ok(error instanceof MetaResultEventError);
    assert.match(error.message, /result event needs configuration/);
    return true;
  });

  const selected = extractResultEvents(ambiguous, { primaryActionType: "offsite_conversion.custom.99" });
  assert.equal(selected.value, 3);
  assert.equal(selected.missing, false);
  assert.equal(extractLeads({ actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "4" }] }), 4);
  assert.equal(diagnoseResultEvents({ actions: [{ action_type: "link_click", value: "12" }] }).needsConfiguration, true);
  const malformed = diagnoseResultEvents({ actions: [{ action_type: "offsite_conversion.custom.lead", value: "not-a-number" }] });
  assert.equal(malformed.value, null);
  assert.equal(malformed.needsConfiguration, true);
});

test("keeps malformed numeric provider fields missing instead of coercing them", () => {
  assert.equal(toOptionalCents("12.34"), 1234);
  assert.equal(toOptionalCents("12.34oops"), null);
  assert.equal(toOptionalFloat("0.25"), 0.25);
  assert.equal(toOptionalFloat("Infinity"), null);
  assert.equal(toOptionalInt("1000"), 1000);
  assert.equal(toOptionalInt("1.5"), null);
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

test("redacts credential-shaped keys and values before raw data is stored or returned", () => {
  const value = redactSensitiveData({
    access_token: token,
    token,
    nested: { authorization: `Bearer ${token}` },
    next: `https://graph.facebook.com/v25.0/path?access_token=${token}`,
    jsonText: `{"token":"${token}"}`,
    id: "safe-id",
  });
  assert.deepEqual(value, {
    access_token: "[REDACTED]",
    token: "[REDACTED]",
    nested: { authorization: "[REDACTED]" },
    next: "https://graph.facebook.com/v25.0/path?access_token=[REDACTED]",
    jsonText: '{"token":"[REDACTED]"}',
    id: "safe-id",
  });
  assert.equal(safeJson(value).includes(token), false);
});
