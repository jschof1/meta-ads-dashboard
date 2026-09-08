import assert from "node:assert/strict";

// Read-only deployment verification apart from normal login/logout bookkeeping.
// Supply credentials through the environment; never print them or raw responses.
const base = process.env.DASHBOARD_SMOKE_URL;
const password = process.env.DASHBOARD_PASSWORD;
assert.ok(base && new URL(base).protocol === "https:", "An HTTPS DASHBOARD_SMOKE_URL is required");
assert.ok(password, "DASHBOARD_PASSWORD is required");
const headers = { "user-agent": "UKTL-deployment-verification/1.0" };
const get = (path, options = {}) => fetch(new URL(path, base), { redirect: "manual", ...options, headers: { ...headers, ...options.headers } });
assert.equal((await get("/login")).status, 200);
for (const path of ["/", "/plan.md", "/plan%2Emd"]) {
  const response = await get(path);
  assert.equal(response.status, 307, `Signed-out ${path} must redirect`);
  assert.equal(new URL(response.headers.get("location"), base).pathname, "/login");
}
for (const path of ["/api/diagnostics", "/api/dashboard/state", "/api/plan", "/api/cron/sync-meta", "/api/cron/sync-highlevel"]) {
  assert.equal((await get(path)).status, 401, `${path} must reject signed-out requests`);
}
for (let session = 0; session < 2; session++) {
  const login = await get("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200, "Live login must succeed");
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=strict/i);
  const cookie = setCookie.split(";")[0];
  const response = await get("/api/diagnostics", { headers: { cookie } });
  assert.equal(response.status, 200);
  const diagnostics = await response.json();
  assert.equal(diagnostics.database.status, "ok");
  assert.equal(diagnostics.migrations.status, "ok");
  assert.equal(diagnostics.migrations.appliedCount, 7);
  assert.equal(diagnostics.meta.actionGate.writesEnabled, false);
  const page = await get("/", { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /UK Trade Leads/);
  const logout = await get("/api/auth", { method: "DELETE", headers: { cookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
  console.info("Cloudflare session verified", { session: session + 1, database: diagnostics.database.status,
    migrations: diagnostics.migrations.appliedCount, meta: diagnostics.meta.status, writesEnabled: false });
}
console.info("Cloudflare deployment smoke passed: protected pages/APIs, secure login/logout, repeated database requests, migration ledger and disabled writes");
