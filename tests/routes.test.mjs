import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;
const port = 4100 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
const dashboardPassword = "route-test-password";
const authSecret = "route-test-auth-secret-that-is-at-least-32-characters";
const cronSecret = "route-test-cron-secret-that-is-at-least-32-characters";
const databasePath = `${root}/route-tests-${process.pid}.db`;

let server;
let serverOutput = "";

async function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(10_000) });
}

async function startServer() {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: root,
    env: {
      ...process.env,
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
      ...process.env,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `file:${databasePath}`,
      DASHBOARD_PASSWORD: dashboardPassword,
      AUTH_SECRET: authSecret,
      CRON_SECRET: cronSecret,
      META_MARKETING_TOKEN: "",
      META_AD_ACCOUNT_ID: "",
      ANTHROPIC_API_KEY: "",
      AIRTABLE_ENABLED: "false",
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

before(startServer, { timeout: 90_000 });

after(async () => {
  if (server && server.exitCode === null) {
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
    ["GET", "/api/meta/diagnostic"],
    ["GET", "/api/insights/summary"],
    ["GET", "/api/insights/brief"],
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
  assert.equal(state.scorecard.today.spendCents, null);

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
  const health = await healthResponse.json();
  assert.equal(health.database, "reachable");
  assert.equal(health.sync.status, "never");

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
