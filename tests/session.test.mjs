import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, readCookie, verifySessionToken } from "../lib/session.ts";

const secret = "a-test-secret-that-is-at-least-32-characters-long";

test("accepts a valid signed session before expiry", async () => {
  const now = Date.UTC(2026, 8, 4);
  const token = await createSessionToken(secret, now);
  assert.equal(await verifySessionToken(token, secret, now + 1_000), true);
});

test("rejects tampered, expired, and weakly configured sessions", async () => {
  const now = Date.UTC(2026, 8, 4);
  const token = await createSessionToken(secret, now);
  assert.equal(await verifySessionToken(`${token}x`, secret, now), false);
  assert.equal(await verifySessionToken(token, secret, now + 13 * 60 * 60 * 1_000), false);
  assert.equal(await verifySessionToken(token, "too-short", now), false);
});

test("reads only the requested cookie", () => {
  assert.equal(readCookie("theme=dark; uktl_dashboard_session=token-value; x=1", "uktl_dashboard_session"), "token-value");
  assert.equal(readCookie("not_the_session=no", "uktl_dashboard_session"), undefined);
});
