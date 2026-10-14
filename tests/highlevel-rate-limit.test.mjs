import test from "node:test";
import assert from "node:assert/strict";
import { createHighLevelPacedFetcher, highLevelRetryDelay, readHighLevelRateLimit } from "../lib/highlevel-rate-limit.ts";

test("treats absent rate-limit headers as unknown rather than numeric zero", () => {
  const rate = readHighLevelRateLimit(new Headers());
  assert.deepEqual(rate, {
    dailyLimit: null, dailyRemaining: null, intervalMs: null,
    shortLimit: null, shortRemaining: null, retryAfterMs: null,
  });
  assert.equal(highLevelRetryDelay(rate), 10_000);
  assert.equal(highLevelRetryDelay(readHighLevelRateLimit(new Headers({ "x-ratelimit-daily-remaining": "0" }))), null);
});

test("parses seconds and HTTP-date Retry-After values without truncating provider delays", () => {
  const seconds = readHighLevelRateLimit(new Headers({ "retry-after": "30", "x-ratelimit-interval-milliseconds": "10000" }));
  assert.equal(seconds.retryAfterMs, 30_000);
  assert.equal(highLevelRetryDelay(seconds), 30_000);
  const now = Date.parse("2026-10-04T12:00:00Z");
  const date = readHighLevelRateLimit(new Headers({ "retry-after": "Sun, 04 Oct 2026 12:00:12 GMT" }), now);
  assert.equal(date.retryAfterMs, 12_000);
});

test("paces concurrent requests and stops making provider calls after daily quota reaches zero", async () => {
  let clock = 1_000;
  let calls = 0;
  const starts = [];
  const fetcher = createHighLevelPacedFetcher(async () => {
    starts.push(clock);
    calls += 1;
    return new Response("{}", { status: 200, headers: { "x-ratelimit-daily-remaining": calls === 1 ? "5" : "0" } });
  }, { minIntervalMs: 250, now: () => clock, sleep: async (ms) => { clock += ms; } });

  const responses = await Promise.all([fetcher("https://example.test/1"), fetcher("https://example.test/2")]);
  assert.deepEqual(starts, [1_000, 1_250]);
  assert.equal(responses[1].status, 200);
  const exhausted = await fetcher("https://example.test/3");
  assert.equal(exhausted.status, 429);
  assert.equal(exhausted.headers.get("x-ratelimit-daily-remaining"), "0");
  assert.equal(calls, 2);
});
