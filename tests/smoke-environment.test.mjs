import test from "node:test";
import assert from "node:assert/strict";
import { safeSmokeEnvironment, smokeDownloadEnvironment } from "../scripts/libsql-smoke-server.mjs";

test("public fixture downloads retain runner transport without forwarding provider credentials", () => {
  const env = {
    PATH: "/fixture/bin",
    HTTPS_PROXY: "http://runner-proxy.example:8080",
    https_proxy: "http://runner-proxy.example:8080",
    NO_PROXY: "127.0.0.1,localhost",
    DASHBOARD_PASSWORD: "fixture-password-must-not-leak",
    TURSO_AUTH_TOKEN: "fixture-token-must-not-leak",
    META_MARKETING_TOKEN: "fixture-token-must-not-leak",
    NODE_OPTIONS: "fixture-options-must-not-leak",
  };
  const downloader = smokeDownloadEnvironment(env);
  assert.equal(downloader.HTTPS_PROXY, env.HTTPS_PROXY);
  assert.equal(downloader.https_proxy, env.https_proxy);
  assert.equal(downloader.NO_PROXY, env.NO_PROXY);
  assert.equal(JSON.stringify(downloader).includes("must-not-leak"), false);
  assert.deepEqual(safeSmokeEnvironment(env), { PATH: env.PATH });
});
