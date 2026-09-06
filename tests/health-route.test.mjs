import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, SESSION_COOKIE } from "../lib/session.ts";

const authSecret = "health-route-synthetic-auth-secret-at-least-32-characters";
const originalEnvironment = process.env;
const originalPrisma = globalThis.prisma;
function environment() {
  return {
    // Retain Node's test-worker marker, but no application credentials/config.
    ...(originalEnvironment.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnvironment.NODE_TEST_CONTEXT } : {}),
    NODE_ENV: "test",
    DATABASE_URL: "file:health-route-unused.db",
    DASHBOARD_PASSWORD: "synthetic-health-password",
    AUTH_SECRET: authSecret,
    CRON_SECRET: "synthetic-health-cron-secret-at-least-32-characters",
    META_AD_ACCOUNT_ID: "health-fixture",
    META_CAMPAIGN_ID: "health-campaign",
    META_ATTRIBUTION_WINDOWS: " 7d_click, 1d_view ",
  };
}

function unexpectedDatabaseCall() {
  assert.fail("Health tests must explicitly mock every database operation");
}

// Install the default-client double before importing the actual route. No
// Prisma connection is constructed and no local DB or provider is contacted.
process.env = environment();
globalThis.prisma = {
  $queryRaw: unexpectedDatabaseCall,
  syncRun: { findFirst: unexpectedDatabaseCall },
};
const { prisma } = await import("../lib/db.ts");
const { GET } = await import("../app/api/health/route.ts");
assert.equal(prisma, globalThis.prisma);

beforeEach(() => { process.env = environment(); });
after(() => {
  process.env = originalEnvironment;
  if (originalPrisma === undefined) delete globalThis.prisma;
  else globalThis.prisma = originalPrisma;
});

async function health() {
  const token = await createSessionToken(authSecret);
  const response = await GET(new Request("http://localhost/api/health", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  }));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { response, body: await response.json() };
}

function assertUnknown({ response, body }, database) {
  assert.equal(response.status, 503);
  assert.equal(body.status, "degraded");
  assert.equal(body.database, database);
  assert.deepEqual(body.sync, { status: "unknown", lastSyncAt: null, lastAttemptAt: null });
}

test("health rejects missing or invalid signed sessions before querying the database", async (t) => {
  const probe = t.mock.method(prisma, "$queryRaw", unexpectedDatabaseCall);
  const query = t.mock.method(prisma.syncRun, "findFirst", unexpectedDatabaseCall);
  for (const cookie of ["", `${SESSION_COOKIE}=invalid.signature`]) {
    const response = await GET(new Request("http://localhost/api/health", { headers: { cookie } }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }
  assert.equal(probe.mock.callCount(), 0);
  assert.equal(query.mock.callCount(), 0);
});

for (const failedQuery of ["attempt", "success"]) {
  test(`health reports unknown when the DB probe succeeds but the ${failedQuery} query fails`, async (t) => {
    t.mock.method(prisma, "$queryRaw", async () => [{ "1": 1 }]);
    t.mock.method(prisma.syncRun, "findFirst", async ({ where }) => {
      if ((where.status === "SUCCEEDED") === (failedQuery === "success")) {
        throw new Error("synthetic private database credential and missing SyncRun table");
      }
      return { status: "SUCCEEDED", startedAt: new Date(), finishedAt: new Date() };
    });
    const result = await health();
    assertUnknown(result, "reachable");
    assert.doesNotMatch(JSON.stringify(result.body), /credential|SyncRun|synthetic private/);
  });
}

test("health reports an unavailable probe without guessing sync history", async (t) => {
  t.mock.method(prisma, "$queryRaw", async () => { throw new Error("private connection details"); });
  const query = t.mock.method(prisma.syncRun, "findFirst", unexpectedDatabaseCall);
  const result = await health();
  assertUnknown(result, "unreachable");
  assert.doesNotMatch(JSON.stringify(result.body), /private connection details/);
  assert.equal(query.mock.callCount(), 0);
});

test("health fails closed before the probe when the database is unconfigured", async (t) => {
  delete process.env.DATABASE_URL;
  const probe = t.mock.method(prisma, "$queryRaw", unexpectedDatabaseCall);
  const result = await health();
  assertUnknown(result, "unreachable");
  assert.equal(result.body.configuration.database, "misconfigured");
  assert.equal(probe.mock.callCount(), 0);
});

test("health reports unknown without querying another account when scope is missing", async (t) => {
  delete process.env.META_AD_ACCOUNT_ID;
  t.mock.method(prisma, "$queryRaw", async () => [{ "1": 1 }]);
  const query = t.mock.method(prisma.syncRun, "findFirst", unexpectedDatabaseCall);
  assertUnknown(await health(), "reachable");
  assert.equal(query.mock.callCount(), 0);
});

test("health reports never only after both scoped sync queries succeed with no rows", async (t) => {
  t.mock.method(prisma, "$queryRaw", async () => [{ "1": 1 }]);
  const query = t.mock.method(prisma.syncRun, "findFirst", async () => null);
  const { response, body } = await health();
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.database, "reachable");
  assert.deepEqual(body.sync, { status: "never", lastSyncAt: null, lastAttemptAt: null });
  const scope = { accountId: "act_health-fixture", campaignId: "health-campaign", attributionKey: "7d_click,1d_view" };
  assert.deepEqual(query.mock.calls.map(({ arguments: [args] }) => args.where), [scope, { ...scope, status: "SUCCEEDED" }]);
});

for (const status of ["completed", "running", "failed", "stale"]) {
  test(`health preserves the readable ${status} sync state and timestamps`, async (t) => {
    const finishedAt = new Date(Date.now() - (status === "stale" ? 27 * 60 * 60 * 1_000 : 60_000));
    const startedAt = new Date(finishedAt.getTime() - 60_000);
    const attemptStatus = status === "running" ? "RUNNING" : status === "failed" ? "FAILED" : "SUCCEEDED";
    t.mock.method(prisma, "$queryRaw", async () => [{ "1": 1 }]);
    t.mock.method(prisma.syncRun, "findFirst", async ({ where }) => where.status === "SUCCEEDED"
      ? { finishedAt }
      : { status: attemptStatus, startedAt, finishedAt: status === "running" ? null : finishedAt });
    const { response, body } = await health();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.deepEqual(body.sync, {
      status,
      lastSyncAt: finishedAt.toISOString(),
      lastAttemptAt: (status === "running" ? startedAt : finishedAt).toISOString(),
    });
  });
}
