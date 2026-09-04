import test from "node:test";
import assert from "node:assert/strict";
import { getSafeEnvironmentStatus, validateAuthEnvironment, validateCronEnvironment } from "../lib/env.ts";

test("requires authentication and cron secrets of an appropriate length", () => {
  assert.deepEqual(validateAuthEnvironment({}), [
    "DASHBOARD_PASSWORD is required",
    "AUTH_SECRET must be at least 32 characters",
  ]);
  assert.deepEqual(validateCronEnvironment({ CRON_SECRET: "short" }), ["CRON_SECRET must be at least 32 characters"]);
});

test("safe status reports presence without exposing configuration values", () => {
  const status = getSafeEnvironmentStatus({
    DASHBOARD_PASSWORD: "password",
    AUTH_SECRET: "a".repeat(32),
    CRON_SECRET: "b".repeat(32),
    DATABASE_URL: "file:secret.db",
    META_MARKETING_TOKEN: "private-token",
    META_AD_ACCOUNT_ID: "act_1",
  });
  assert.deepEqual(status, {
    authentication: "configured",
    cron: "configured",
    database: "configured",
    meta: "configured",
    ai: "not_configured",
  });
  assert.equal(JSON.stringify(status).includes("private-token"), false);
});
