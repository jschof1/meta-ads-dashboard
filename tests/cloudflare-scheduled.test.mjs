import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClientAddress, runScheduledSync } from "../lib/cloudflare-scheduled.mjs";

test("Cloudflare schedules call only the matching protected route and propagate failures", async () => {
  const env = { CRON_SECRET: "fixture-secret-with-at-least-32-characters", HIGHLEVEL_SYNC_ENABLED: "true" };
  for (const [cron, path] of [["15 * * * *", "sync-leads"], ["0 6 * * *", "sync-meta"], ["30 6 * * *", "sync-highlevel"]]) {
    await runScheduledSync({ cron }, env, async (request) => {
      assert.equal(new URL(request.url).pathname, `/api/cron/${path}`);
      assert.equal(request.headers.get("authorization"), `Bearer ${env.CRON_SECRET}`);
      return new Response("ok");
    });
  }
  await assert.rejects(runScheduledSync({ cron: "0 6 * * *" }, env, async () => new Response("failed", { status: 500 })), /HTTP 500/);
});

test("disabled CRM, missing credentials and unknown schedules never dispatch", async () => {
  const never = () => { throw new Error("must not dispatch"); };
  await runScheduledSync({ cron: "30 6 * * *" }, {}, never);
  await assert.rejects(runScheduledSync({ cron: "0 6 * * *" }, {}, never), /authentication/);
  await assert.rejects(runScheduledSync({ cron: "* * * * *" }, {}, never), /Unknown/);
});

test("Cloudflare client address overrides spoofed login rate-limit headers", () => {
  const incoming = new Request("https://dashboard.example/api/auth", { headers: {
    "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "attacker", "x-real-ip": "attacker",
  } });
  const normalized = normalizeClientAddress(incoming);
  assert.equal(normalized.headers.get("x-forwarded-for"), "192.0.2.1");
  assert.equal(normalized.headers.has("x-real-ip"), false);
  const missing = normalizeClientAddress(new Request("https://dashboard.example", { headers: { "x-forwarded-for": "attacker" } }));
  assert.equal(missing.headers.get("x-forwarded-for"), "unknown");
});
