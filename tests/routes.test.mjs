import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const port = 4100 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
const dashboardPassword = "route-test-password";
const authSecret = "route-test-auth-secret-that-is-at-least-32-characters";
const cronSecret = "route-test-cron-secret-that-is-at-least-32-characters";

let server;
let serverOutput = "";

async function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(10_000) });
}

async function startServer() {
  server = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "development",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `file:./route-tests-${process.pid}.db`,
      DASHBOARD_PASSWORD: dashboardPassword,
      AUTH_SECRET: authSecret,
      CRON_SECRET: cronSecret,
      META_MARKETING_TOKEN: "",
      META_AD_ACCOUNT_ID: "",
      AIRTABLE_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
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
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await wait(500);
  if (server.exitCode === null) server.kill("SIGKILL");
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

test("protected APIs reject requests without a session", async () => {
  const routes = [
    ["GET", "/api/plan"],
    ["GET", "/api/dashboard/state"],
    ["GET", "/api/health"],
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
