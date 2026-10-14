import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const run = args => spawnSync(process.execPath, ["--import=tsx", "scripts/backfill-meta-history.mjs", ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { PATH: process.env.PATH, TZ: "UTC" }, timeout: 15000 });
test("the existing history command plans bounded months without any provider credentials", () => {
  const result = run(["--since=2026-01-01", "--until=2026-10-13"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout); assert.equal(plan.action, "plan"); assert.equal(plan.months.length, 10);
  assert.deepEqual(plan.months[0], { since: "2026-01-01", until: "2026-01-31" });
  assert.deepEqual(plan.months[9], { since: "2026-10-01", until: "2026-10-13" });
  assert.deepEqual(plan.levels, ["account", "campaign", "adset", "ad"]);
});
test("history apply fails before constructing a provider without explicit approval, and invalid dates fail", () => {
  const result = run(["--since=2026-01-01", "--until=2026-01-31", "--apply"]);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /META_HISTORY_APPLY_APPROVED/);
  assert.notEqual(run(["--since=2026-02-30", "--until=2026-03-01"]).status, 0);
});
