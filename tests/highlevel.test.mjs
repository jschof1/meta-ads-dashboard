import test from "node:test";
import assert from "node:assert/strict";
import { createHighLevelClient, HighLevelApiError } from "../lib/highlevel.ts";
import { loadHighLevelSettings } from "../lib/highlevel-config.ts";

function env(overrides = {}) {
  return {
    HIGHLEVEL_TOKEN: "test-highlevel-token",
    HIGHLEVEL_LOCATION_ID: "location-1",
    HIGHLEVEL_API_VERSION: "v3",
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
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("uses fixed v3 paths, bearer/version headers, bounded pagination, and ignores provider nextPageUrl", async () => {
  const config = loadHighLevelSettings(env({ HIGHLEVEL_MAX_RECORDS: "101" }));
  const calls = [];
  const client = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async (url, init) => {
      const parsed = new URL(url);
      calls.push({ url: parsed.toString(), method: init.method, authorization: new Headers(init.headers).get("Authorization"), version: new Headers(init.headers).get("Version"), body: init.body });
      assert.equal(parsed.origin, "https://services.leadconnectorhq.com");
      assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-highlevel-token");
      assert.equal(new Headers(init.headers).get("Version"), "v3");
      if (parsed.pathname === "/opportunities/pipelines") {
        assert.equal(parsed.searchParams.get("locationId"), "location-1");
        return response({ pipelines: [{ id: "pipeline-1", locationId: "location-1", stages: [
          { id: "stage-lead" }, { id: "stage-contacted" }, { id: "stage-qualified" }, { id: "stage-booked" }, { id: "stage-attended" },
        ] }] });
      }
      if (parsed.pathname === "/contacts/search") {
        const body = JSON.parse(init.body);
        assert.equal(init.method, "POST");
        assert.deepEqual(body, { locationId: "location-1", page: Number(parsed.searchParams.get("page") ?? body.page), pageLimit: 100 });
        if (body.page === 1) return response({ contacts: Array.from({ length: 100 }, (_, index) => ({ id: `contact-${index}` })), total: 101, nextPageUrl: "https://evil.example/contacts" });
        return response({ contacts: [{ id: "contact-100" }], total: 101 });
      }
      if (parsed.pathname === "/opportunities/search") {
        assert.equal(init.method, "GET");
        assert.equal(parsed.searchParams.get("locationId"), "location-1");
        assert.equal(parsed.searchParams.get("pipelineId"), "pipeline-1");
        assert.equal(parsed.searchParams.get("status"), "all");
        assert.equal(parsed.searchParams.get("limit"), "100");
        return response({ opportunities: [{ id: "opportunity-1" }], meta: { total: 1, nextPageUrl: "https://evil.example/opportunities" } });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const pipeline = await client.getPipeline();
  const contacts = await client.listContacts();
  const opportunities = await client.listOpportunities();
  assert.equal(pipeline.locationId, "location-1");
  assert.equal(contacts.items.length, 101);
  assert.equal(opportunities.items.length, 1);
  assert.equal(contacts.truncated, false);
  assert.equal(opportunities.truncated, false);
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/opportunities/pipelines",
    "/contacts/search",
    "/contacts/search",
    "/opportunities/search",
  ]);
  assert.equal(calls[1].body.includes("test-highlevel-token"), false);
});

test("marks a capped collection as partial when the provider proves or implies more rows", async () => {
  const config = loadHighLevelSettings(env({ HIGHLEVEL_MAX_RECORDS: "1" }));
  const client = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/contacts/search") return response({ contacts: [{ id: "contact-1" }], total: 2 });
      if (path === "/opportunities/search") return response({ opportunities: Array.from({ length: 100 }, (_, index) => ({ id: `opportunity-${index}` })) });
      return response({ id: "pipeline-1", locationId: "location-1", stages: [] });
    },
  });
  const contacts = await client.listContacts();
  const opportunities = await client.listOpportunities();
  assert.equal(contacts.truncated, true);
  assert.equal(contacts.providerTotal, 2);
  assert.equal(opportunities.truncated, true);
  assert.equal(opportunities.providerTotal, null);
});

test("marks a short provider page as partial when its total proves more rows exist", async () => {
  const config = loadHighLevelSettings(env({ HIGHLEVEL_MAX_RECORDS: "1000" }));
  const client = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async () => response({ contacts: Array.from({ length: 20 }, (_, index) => ({ id: `contact-${index}` })), total: 101 }),
  });

  const contacts = await client.listContacts();
  assert.equal(contacts.items.length, 20);
  assert.equal(contacts.providerTotal, 101);
  assert.equal(contacts.truncated, true);
});

test("retries transient provider responses without following provider-controlled URLs", async () => {
  const config = loadHighLevelSettings(env());
  let attempts = 0;
  const sleeps = [];
  const client = createHighLevelClient({
    config,
    maxRetries: 2,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    fetcher: async (url) => {
      if (new URL(url).pathname !== "/opportunities/search") return response({ opportunities: [] });
      attempts += 1;
      if (attempts === 1) return new Response("busy", { status: 503, headers: { "retry-after": "1" } });
      return response({ opportunities: [{ id: "opportunity-1" }], meta: { total: 1, nextPageUrl: "https://evil.example" } });
    },
  });
  const result = await client.listOpportunities();
  assert.equal(result.items.length, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1000]);
});

test("fails closed on malformed responses and provider errors without exposing the token", async () => {
  const config = loadHighLevelSettings(env());
  const malformed = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(() => malformed.listContacts(), (error) => {
    assert.ok(error instanceof HighLevelApiError);
    assert.equal(error.operation, "contacts search");
    assert.match(error.message, /malformed JSON/);
    assert.equal(error.message.includes("test-highlevel-token"), false);
    return true;
  });

  const unauthorized = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async () => response({ error: "provider detail must not be surfaced" }, 401),
  });
  await assert.rejects(() => unauthorized.listOpportunities(), (error) => {
    assert.ok(error instanceof HighLevelApiError);
    assert.equal(error.status, 401);
    assert.match(error.message, /HTTP 401/);
    assert.equal(JSON.stringify(error).includes("test-highlevel-token"), false);
    return true;
  });

  const malformedRows = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async () => response({ contacts: [{ id: "valid" }, "not-a-contact"] }),
  });
  await assert.rejects(() => malformedRows.listContacts(), /invalid collection/);

  const malformedPipeline = createHighLevelClient({
    config,
    maxRetries: 0,
    fetcher: async () => response({ pipelines: [{ id: "pipeline-1", locationId: "location-1", stages: [{ id: "stage-lead" }, null] }] }),
  });
  await assert.rejects(() => malformedPipeline.getPipeline(), /invalid pipeline/);
});

test("selects only one exact location-scoped pipeline and rejects missing, duplicate or foreign matches", async () => {
  const config = loadHighLevelSettings(env());
  const valid = { id: "pipeline-1", locationId: "location-1", stages: [{ id: "stage-lead" }] };
  for (const pipelines of [[], [valid, valid], [{ ...valid, locationId: "foreign-location" }], [{ ...valid, id: "another-pipeline" }]]) {
    const client = createHighLevelClient({ config, maxRetries: 0, fetcher: async () => response({ pipelines }) });
    await assert.rejects(() => client.getPipeline(), HighLevelApiError);
  }
  const client = createHighLevelClient({ config, maxRetries: 0, fetcher: async () => response({ pipelines: [{ ...valid, id: "another-pipeline" }, valid] }) });
  assert.equal((await client.getPipeline()).id, "pipeline-1");
});

test("requires the explicit sync gate and rejects a non-v3 configuration", () => {
  const disabled = loadHighLevelSettings(env({ HIGHLEVEL_SYNC_ENABLED: "false" }));
  assert.equal(disabled.mappingReady, true);
  assert.equal(disabled.providerReady, false);
  assert.equal(disabled.status, "disabled");

  const oldVersion = loadHighLevelSettings(env({ HIGHLEVEL_API_VERSION: "2021-07-28" }));
  assert.equal(oldVersion.mappingReady, false);
  assert.equal(oldVersion.status, "misconfigured");
  assert.match(oldVersion.errors.join(" "), /HIGHLEVEL_API_VERSION/);

  const duplicateStage = loadHighLevelSettings(env({ HIGHLEVEL_STAGE_CONTACTED_ID: "stage-lead" }));
  assert.equal(duplicateStage.mappingReady, false);
  assert.match(duplicateStage.errors.join(" "), /stage IDs must be distinct/);

  const duplicateAttributionField = loadHighLevelSettings(env({ HIGHLEVEL_META_AD_ID_FIELD_ID: "field", HIGHLEVEL_META_CAMPAIGN_ID_FIELD_ID: "field" }));
  assert.equal(duplicateAttributionField.mappingReady, false);
  assert.match(duplicateAttributionField.errors.join(" "), /must differ/);

  const invalidGate = loadHighLevelSettings(env({ HIGHLEVEL_SYNC_ENABLED: "TRUE" }));
  assert.equal(invalidGate.providerReady, false);
  assert.match(invalidGate.errors.join(" "), /HIGHLEVEL_SYNC_ENABLED/);
});
