import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { createPrismaClient } from "../lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../lib/session.ts";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;
const port = 4100 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
const dashboardPassword = "route-test-password";
const authSecret = "route-test-auth-secret-that-is-at-least-32-characters";
const cronSecret = "route-test-cron-secret-that-is-at-least-32-characters";
const routeAccountId = "act_route-test-account";
const routeAttributionKey = "7d_click,1d_view";
const databasePath = `${root}/route-tests-${process.pid}.db`;
const safeEnvironment = Object.fromEntries(
  ["PATH", "HOME", "USERPROFILE", "CI", "LANG", "LC_ALL", "TMPDIR"]
    .filter((name) => process.env[name] !== undefined)
    .map((name) => [name, process.env[name]]),
);

let server;
let serverOutput = "";
let seedDb;

function routeEvidence() {
  const metrics = {
    spendCents: 24000,
    impressions: 12000,
    reach: 9000,
    clicks: 240,
    linkClicks: 120,
    leads: 3,
    frequency: 1.33,
    cplCents: 8000,
    cpmCents: 200,
    cpcCents: 100,
    ctrLink: 1,
  };
  return {
    evidenceVersion: 1,
    ruleVersion: "pr06.v1",
    comparisonDays: 7,
    ranges: {
      current: { since: "2026-08-29", until: "2026-09-04" },
      previous: null,
      cumulative: null,
    },
    sampleSize: 3,
    seriesPoints: 0,
    daysActive: 14,
    confidenceScore: 75,
    confidenceFactors: {
      currentSpendImpressionsComplete: true,
      currentLeadsKnown: true,
      currentEvidenceSufficient: true,
      previousEvidenceSufficient: false,
      sampleSizeSufficient: true,
      seriesSufficient: false,
      daysActiveSufficient: true,
    },
    status: "ACTIVE",
    learningState: null,
    current: metrics,
    previous: null,
    cumulative: null,
    series: [],
    deltas: { spendPct: null, leadsPct: null, cplPct: null, ctrPct: null, frequencyPct: null },
    thresholds: {
      minLeads: 3,
      minImpressions: 1000,
      minSpendCents: 1000,
      cplTargetCents: 1500,
      cplAcceptableCents: 2500,
      cplMaximumCents: 3500,
      frequencyWatch: 2,
      frequencyAlert: 3,
      expectedSpendCents: null,
      budgetCents: null,
    },
    notes: ["Seeded route-test evidence"],
  };
}

async function seedActionRouteFixtures() {
  seedDb = createPrismaClient({ url: `file:${databasePath}` });
  const now = new Date();
  const runId = "route-test-sync-run";
  await seedDb.syncRun.create({
    data: {
      id: runId,
      accountId: routeAccountId,
      campaignId: null,
      trigger: "route-test",
      status: "SUCCEEDED",
      attributionKey: routeAttributionKey,
      startedAt: new Date(now.getTime() - 60_000),
      finishedAt: now,
    },
  });
  await seedDb.syncRun.create({
    data: {
      id: "route-test-unrelated-sync-run",
      accountId: "act_unrelated-account",
      campaignId: null,
      trigger: "route-test",
      status: "SUCCEEDED",
      attributionKey: routeAttributionKey,
      startedAt: new Date("2030-01-01T11:59:00.000Z"),
      finishedAt: new Date("2030-01-01T12:00:00.000Z"),
    },
  });
  for (const suffix of ["approve", "reject", "missing-token"]) {
    const targetId = `ad-route-${suffix}`;
    const fingerprint = `${routeAccountId}|account|${routeAttributionKey}|route-${suffix}`;
    await seedDb.ad.create({
      data: {
        id: `db-${targetId}`,
        metaId: targetId,
        name: `Route test ${suffix} target`,
        configuredStatus: "ACTIVE",
        effectiveStatus: "ACTIVE",
        lastSeenSyncRunId: runId,
        raw: "{}",
        createdAt: now,
        updatedAt: now,
      },
    });
    await seedDb.recommendation.create({
      data: {
        id: `recommendation-${targetId}`,
        fingerprint,
        accountId: routeAccountId,
        campaignId: null,
        attributionKey: routeAttributionKey,
        type: "pause_candidate",
        analysisWindowDays: 7,
        ruleVersion: "pr06.v1",
        targetType: "ad",
        targetId,
        targetName: `Route test ${suffix} target`,
        severity: "alert",
        confidence: "high",
        lifecycle: "OPEN",
        reason: `Server-sourced reason for ${suffix}`,
        evidence: JSON.stringify(routeEvidence()),
        proposedAction: "Pause this ad after operator review.",
        sourceSyncRunId: runId,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
  return now;
}

async function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(10_000) });
}

async function startServer(overrides = {}) {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: root,
    env: {
      ...safeEnvironment,
      RUST_LOG: "info",
      DATABASE_URL: `file:${databasePath}`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
    stdio: "ignore",
  });
  server = spawn(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...safeEnvironment,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `file:${databasePath}`,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
      DASHBOARD_PASSWORD: dashboardPassword,
      AUTH_SECRET: authSecret,
      CRON_SECRET: cronSecret,
      META_MARKETING_TOKEN: "",
      META_AD_ACCOUNT_ID: routeAccountId,
      META_WRITES_ENABLED: "false",
      META_ACTION_MAX_DAILY_BUDGET_MINOR: "20000",
      META_ACTION_MAX_BUDGET_CHANGE_PERCENT: "20",
      ANTHROPIC_API_KEY: "",
      HIGHLEVEL_TOKEN: "",
      HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN: "",
      HIGHLEVEL_SYNC_ENABLED: "false",
      AIRTABLE_ENABLED: "false",
      ...overrides,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next dev server exited with ${server.exitCode}:\n${serverOutput}`);
    }
    try {
      const response = await get("/login");
      if (response.status === 200) return;
    } catch {
      // The server is still compiling or listening has not started yet.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for Next dev server:\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const pid = server.pid;
  const signal = (name) => {
    try {
      if (process.platform === "win32" || !pid) server.kill(name);
      else process.kill(-pid, name);
    } catch {
      // The process may have exited between the status check and the signal.
    }
  };
  signal("SIGTERM");
  await wait(1_000);
  if (server.exitCode === null) signal("SIGKILL");
}

before(startServer, { timeout: 90_000 });

after(async () => {
  await stopServer();
  await seedDb?.$disconnect();
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-journal`, { force: true });
});

test("login, protected plan access, and logout work through route handlers", async () => {
  const login = await get("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10" },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie ?? "", /uktl_dashboard_session=/);
  const cookie = setCookie?.match(/uktl_dashboard_session=[^;]+/)?.[0];
  assert.ok(cookie);

  const plan = await get("/api/plan", { headers: { cookie } });
  assert.equal(plan.status, 200);
  assert.equal(typeof (await plan.json()).plan, "string");

  const logout = await get("/api/auth", { method: "DELETE", headers: { cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /uktl_dashboard_session=;/);

  const afterLogout = await get("/api/plan");
  assert.equal(afterLogout.status, 401);
});

test("the optional static plan file stays behind the authentication boundary", async () => {
  const response = await get("/plan.md", { redirect: "manual" });
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/login$/);
});

test("protected APIs reject requests without a session", async () => {
  const routes = [
    ["GET", "/api/plan"],
    ["GET", "/api/dashboard/state"],
    ["GET", "/api/health"],
    ["GET", "/api/diagnostics"],
    ["GET", "/api/meta/diagnostic"],
    ["GET", "/api/insights/summary"],
    ["GET", "/api/insights/brief"],
    ["GET", "/api/actions"],
    ["POST", "/api/actions"],
    ["POST", "/api/actions/example-id/approve"],
    ["POST", "/api/actions/example-id/reject"],
    ["POST", "/api/actions/example-id/execute"],
    ["POST", "/api/insights/summary"],
    ["POST", "/api/insights/brief"],
    ["POST", "/api/refresh"],
  ];

  for (const [method, path] of routes) {
    const response = await get(path, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : undefined,
      body: method === "POST" ? "{}" : undefined,
    });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("cron route requires its bearer secret", async () => {
  const missing = await get("/api/cron/sync-meta");
  assert.equal(missing.status, 401);

  const wrong = await get("/api/cron/sync-meta", { headers: { authorization: "Bearer wrong-secret" } });
  assert.equal(wrong.status, 401);

  const valid = await get("/api/cron/sync-meta", { headers: { authorization: `Bearer ${cronSecret}` } });
  assert.notEqual(valid.status, 401);
  assert.equal(valid.status, 500);
  const payload = await valid.json();
  assert.equal(payload.error, "Meta sync failed; the last successful data remains available.");
  assert.equal(JSON.stringify(payload).includes("META_MARKETING_TOKEN"), false);

  const highLevelMissing = await get("/api/cron/sync-highlevel");
  assert.equal(highLevelMissing.status, 401);
  const highLevelWrong = await get("/api/cron/sync-highlevel", { headers: { authorization: "Bearer wrong-secret" } });
  assert.equal(highLevelWrong.status, 401);
  const highLevelDisabled = await get("/api/cron/sync-highlevel", { headers: { authorization: `Bearer ${cronSecret}` } });
  assert.equal(highLevelDisabled.status, 200);
  const highLevelPayload = await highLevelDisabled.json();
  assert.equal(highLevelPayload.status, "DISABLED");
  assert.equal(JSON.stringify(highLevelPayload).includes("HIGHLEVEL_TOKEN"), false);
});

test("authenticated dashboard, health, manual refresh, cron POST, and diagnostics use durable safe contracts", async () => {
  const login = await get("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.12" },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.match(/uktl_dashboard_session=[^;]+/)?.[0];
  assert.ok(cookie);

  const stateResponse = await get("/api/dashboard/state", { headers: { cookie } });
  assert.equal(stateResponse.status, 200);
  const state = await stateResponse.json();
  assert.equal(state.meta.syncState, "never");
  assert.equal(state.meta.actionGate.status, "disabled");
  assert.equal(state.meta.actionGate.writesEnabled, false);
  assert.deepEqual(state.metaActions, []);
  assert.equal(state.scorecard.today.spendCents, null);

  const actions = await get("/api/actions", { headers: { cookie } });
  assert.equal(actions.status, 200);
  const actionPayload = await actions.json();
  assert.deepEqual(actionPayload.actions, []);
  assert.equal(actionPayload.gate.status, "disabled");
  assert.equal(JSON.stringify(actionPayload).includes("META_MARKETING_TOKEN"), false);

  for (const path of ["/api/insights/summary", "/api/insights/brief"]) {
    const read = await get(path, { headers: { cookie } });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("cache-control"), "private, no-store");
    const readPayload = await read.json();
    assert.equal(readPayload.enabled, false);
    assert.equal(readPayload.status, "not_generated");
    assert.equal(readPayload.briefing, null);
    const generated = await get(path, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ forgedMetrics: { leads: 999_999 }, currencyCode: "USD", creative: "forged" }),
    });
    assert.equal(generated.status, 200);
    assert.equal(generated.headers.get("cache-control"), "private, no-store");
    const generatedPayload = await generated.json();
    assert.equal(generatedPayload.enabled, false);
    assert.equal(generatedPayload.status, "disabled");
    assert.equal(generatedPayload.briefing, null);
    assert.doesNotMatch(JSON.stringify(generatedPayload), /999999|USD|forged/);
  }

  const healthResponse = await get("/api/health", { headers: { cookie } });
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("cache-control"), "private, no-store");
  const health = await healthResponse.json();
  assert.equal(health.database, "reachable");
  assert.equal(health.sync.status, "never");

  const diagnosticsResponse = await get("/api/diagnostics", { headers: { cookie } });
  assert.equal(diagnosticsResponse.status, 200);
  assert.equal(diagnosticsResponse.headers.get("cache-control"), "private, no-store");
  const diagnostics = await diagnosticsResponse.json();
  assert.equal(diagnostics.database.status, "ok");
  assert.equal(diagnostics.migrations.status, "ok");
  assert.equal(diagnostics.meta.configuration, "not_configured");
  assert.equal(diagnostics.meta.actionGate.status, "disabled");
  assert.equal(diagnostics.ai.status, "not_configured");
  assert.equal(JSON.stringify(diagnostics).includes("route-test-auth"), false);
  assert.equal(JSON.stringify(diagnostics).includes("META_MARKETING_TOKEN"), false);

  const refresh = await get("/api/refresh", { method: "POST", headers: { cookie } });
  assert.equal(refresh.status, 500);
  assert.equal((await refresh.json()).error, "Meta sync failed; the last successful data remains available.");

  const cron = await get("/api/cron/sync-meta", { method: "POST", headers: { authorization: `Bearer ${cronSecret}` } });
  assert.equal(cron.status, 500);
  assert.equal((await cron.json()).error, "Meta sync failed; the last successful data remains available.");

  const diagnostic = await get("/api/meta/diagnostic", { headers: { cookie } });
  assert.equal(diagnostic.status, 500);
  const diagnosticPayload = await diagnostic.json();
  assert.match(diagnosticPayload.error, /redacted provider diagnostics/);
  assert.equal(JSON.stringify(diagnosticPayload).includes("META_MARKETING_TOKEN"), false);
});

test("login rate limiting returns 429 after five failed attempts", async () => {
  const headers = {
    "content-type": "application/json",
    "x-forwarded-for": "198.51.100.11",
  };
  const statuses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await get("/api/auth", {
      method: "POST",
      headers,
      body: JSON.stringify({ password: "wrong-password" }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test("authenticated action routes require a proposal, approval, and server-side execution gate", async () => {
  const fixtureTime = await seedActionRouteFixtures();
  const login = await get("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.20" },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.match(/uktl_dashboard_session=[^;]+/)?.[0];
  assert.ok(cookie);

  const scopedHealth = await get("/api/health", { headers: { cookie } });
  assert.equal(scopedHealth.status, 200);
  assert.equal((await scopedHealth.json()).sync.lastSyncAt, fixtureTime.toISOString());

  const proposalResponse = await get("/api/actions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      recommendationFingerprint: `${routeAccountId}|account|${routeAttributionKey}|route-approve`,
      action: "pause_ad",
      targetId: "forged-route-target",
      reason: "forged route reason",
    }),
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = await proposalResponse.json();
  assert.equal(proposal.action.status, "PROPOSED");
  assert.equal(proposal.action.targetId, "ad-route-approve");
  assert.equal(proposal.action.targetName, "Route test approve target");
  assert.equal(proposal.action.reasoning, "Server-sourced reason for approve");
  assert.equal(proposal.action.requestedChange.status, "PAUSED");

  const approvedResponse = await get(`/api/actions/${proposal.action.id}/approve`, { method: "POST", headers: { cookie } });
  assert.equal(approvedResponse.status, 200);
  assert.equal((await approvedResponse.json()).action.status, "APPROVED");

  const disabledExecute = await get(`/api/actions/${proposal.action.id}/execute`, { method: "POST", headers: { cookie } });
  assert.equal(disabledExecute.status, 503);
  const disabledPayload = await disabledExecute.json();
  assert.match(disabledPayload.error, /writes are disabled/);
  assert.equal(disabledPayload.action.status, "APPROVED");

  const rejectedProposalResponse = await get("/api/actions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      recommendationFingerprint: `${routeAccountId}|account|${routeAttributionKey}|route-reject`,
      action: "pause_ad",
    }),
  });
  assert.equal(rejectedProposalResponse.status, 201);
  const rejectedProposal = await rejectedProposalResponse.json();
  const rejectedResponse = await get(`/api/actions/${rejectedProposal.action.id}/reject`, { method: "POST", headers: { cookie } });
  assert.equal(rejectedResponse.status, 200);
  assert.equal((await rejectedResponse.json()).action.status, "REJECTED");
  const approveRejected = await get(`/api/actions/${rejectedProposal.action.id}/approve`, { method: "POST", headers: { cookie } });
  assert.equal(approveRejected.status, 409);
  assert.match((await approveRejected.json()).error, /Only a proposed/);
});

test("enabled action routes fail closed when the server token is missing", async () => {
  await stopServer();
  await startServer({ META_WRITES_ENABLED: "true" });
  const login = await get("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.21" },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.match(/uktl_dashboard_session=[^;]+/)?.[0];
  assert.ok(cookie);

  const proposalResponse = await get("/api/actions", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      recommendationFingerprint: `${routeAccountId}|account|${routeAttributionKey}|route-missing-token`,
      action: "pause_ad",
    }),
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = await proposalResponse.json();
  const approvedResponse = await get(`/api/actions/${proposal.action.id}/approve`, { method: "POST", headers: { cookie } });
  assert.equal(approvedResponse.status, 200);

  const execute = await get(`/api/actions/${proposal.action.id}/execute`, { method: "POST", headers: { cookie } });
  assert.equal(execute.status, 503);
  const payload = await execute.json();
  assert.match(payload.error, /not safely configured/);
  assert.equal(payload.action.status, "APPROVED");
  assert.equal((await get("/api/actions", { headers: { cookie } })).status, 200);
  assert.equal((await (await get("/api/actions", { headers: { cookie } })).json()).gate.status, "misconfigured");
});

test("durable-data routes fail closed instead of using a local fallback when the database is unconfigured", async () => {
  await stopServer();
  await startServer({ DATABASE_URL: "", TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" });

  const login = await get("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.22" },
    body: JSON.stringify({ password: dashboardPassword }),
  });
  assert.equal(login.status, 503);
  assert.equal((await login.json()).error, "Authentication is not configured");

  const cookie = [SESSION_COOKIE, await createSessionToken(authSecret)].join("=");
  const health = await get("/api/health", { headers: { cookie } });
  assert.equal(health.status, 503);
  const healthPayload = await health.json();
  assert.equal(healthPayload.configuration.database, "misconfigured");
  assert.equal(healthPayload.database, "unreachable");

  for (const [method, path] of [["GET", "/api/dashboard/state"], ["GET", "/api/actions"], ["POST", "/api/refresh"]]) {
    const response = await get(path, {
      method,
      headers: { cookie, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      body: method === "POST" ? "{}" : undefined,
    });
    assert.equal(response.status, 503, method + " " + path);
  }

  const cron = await get("/api/cron/sync-meta", { headers: { authorization: "Bearer " + cronSecret } });
  assert.equal(cron.status, 503);
});
