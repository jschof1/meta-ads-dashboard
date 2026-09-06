import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url).pathname;
const safeEnvironment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
  .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));

test("synthetic Anthropic validation pins its scope despite non-default inherited attribution", () => {
  const networkTrap = "globalThis.fetch = async () => { throw new Error('Provider network forbidden in fixture test'); };";
  const result = spawnSync(process.execPath, [
    "--import=tsx", `--import=data:text/javascript,${encodeURIComponent(networkTrap)}`,
    "scripts/validate-anthropic.mjs", "--fixture-only",
  ], {
    cwd: root,
    env: { ...safeEnvironment, NODE_ENV: "test", META_AD_ACCOUNT_ID: "act_wrong_fixture", META_CAMPAIGN_ID: "wrong_campaign", META_ATTRIBUTION_WINDOWS: "1d_click" },
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(result.status, 0, result.error ?? result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    validation: "synthetic-only", status: "fixture-ready", attributionWindows: "7d_click,1d_view", providerCalled: false,
  });
});

test("billable Anthropic validation still requires the explicit credential and confirmation gate", () => {
  const result = spawnSync(process.execPath, ["--import=tsx", "scripts/validate-anthropic.mjs"], {
    cwd: root, env: safeEnvironment, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 1, result.error ?? result.stderr);
  assert.match(result.stderr, /ANTHROPIC_VALIDATION_CONFIRM=yes/);
  assert.equal(result.stdout, "");
});
