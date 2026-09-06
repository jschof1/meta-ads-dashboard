import test from "node:test";
import assert from "node:assert/strict";
import { expandConfig } from "@libsql/core/config";
import { createPrismaClient } from "../lib/db.ts";
import { getSafeEnvironmentStatus, validateAuthEnvironment, validateCronEnvironment, validateDatabaseEnvironment } from "../lib/env.ts";

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
    crm: "not_configured",
  });
  assert.equal(JSON.stringify(status).includes("private-token"), false);
});

test("requires a remote Turso URL and token in production", () => {
  assert.deepEqual(validateDatabaseEnvironment({ NODE_ENV: "production", DATABASE_URL: "file:local.db" }), [
    "TURSO_DATABASE_URL is required in production",
    "TURSO_AUTH_TOKEN is required in production",
  ]);
  assert.equal(validateDatabaseEnvironment({ NODE_ENV: "production", TURSO_DATABASE_URL: "libsql://uktl.turso.io", TURSO_AUTH_TOKEN: "token" }).length, 0);
  assert.equal(getSafeEnvironmentStatus({ NODE_ENV: "production", DATABASE_URL: "file:local.db" }).database, "misconfigured");
});

test("rejects plaintext, malformed and TLS-disabled production database URLs", () => {
  for (const url of ["http://db.example.test", "libsql://db.example.test?tls=0", "https://db.example.test?tls=0", "file:local.db", "https://", "libsql://user:password@db.example.test"]) {
    assert.ok(validateDatabaseEnvironment({ NODE_ENV: "production", TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "token" }).length > 0, url);
  }
  assert.deepEqual(validateDatabaseEnvironment({ NODE_ENV: "production", TURSO_DATABASE_URL: "https://db.example.test", TURSO_AUTH_TOKEN: "token" }), []);
});

test("rejects every duplicate TLS parameter using the actual driver's decoded semantics", () => {
  for (const [query, driverTls] of [
    ["tls=1&tls=0", false],
    ["tls=0&tls=1", true],
    ["tls=1&tls=1", true],
    ["tls=0&tls=0", false],
    ["tls=1&%74ls=0", false],
    ["%74ls=1&tls=1", true],
    ["tls=%31&%74%6c%73=%30", false],
  ]) {
    const url = `libsql://db.example.test:8080?${query}`;
    // expandConfig performs no I/O. Confirm that these are real driver inputs,
    // including enabled duplicates that our stricter policy must still reject.
    const config = expandConfig({ url }, true);
    assert.equal(config.tls, driverTls, query);
    assert.equal(config.scheme, driverTls ? "https" : "http", query);
    const env = { NODE_ENV: "production", TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "test-token" };
    assert.ok(validateDatabaseEnvironment(env).length > 0, query);
    assert.equal(getSafeEnvironmentStatus(env).database, "misconfigured", query);
  }
});

test("accepts only valid effective HTTPS URLs with zero or one enabled TLS parameter", () => {
  for (const scheme of ["https", "libsql"]) {
    for (const query of ["", "?tls=1", "?%74%6c%73=%31"]) {
      const url = `${scheme}://db.example.test:443${query}`;
      assert.deepEqual(validateDatabaseEnvironment({ NODE_ENV: "production", TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "test-token" }), [], url);
    }
    for (const query of ["?tls=1&tls=1", "?tls=0&tls=1", "?tls=1&%74ls=0", "?tls=", "?tls=true", "?%74ls=%30", "?unknown=1", "?tls=%ZZ", "#", "#fragment"]) {
      const url = `${scheme}://db.example.test:443${query}`;
      assert.ok(validateDatabaseEnvironment({ NODE_ENV: "production", TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "test-token" }).length > 0, url);
    }
  }
});

test("default production Prisma client fails closed for both TLS downgrades and enabled duplicates", () => {
  const names = ["NODE_ENV", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "DATABASE_URL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NODE_ENV = "production";
    process.env.TURSO_AUTH_TOKEN = "synthetic-test-token";
    process.env.DATABASE_URL = "file:must-not-be-opened.db";
    for (const url of [
      "http://db.example.test:8080", "libsql://db.example.test:8080?tls=0",
      "libsql://db.example.test:8080?tls=1&tls=0", "libsql://db.example.test:8080?tls=1&tls=1",
      "libsql://db.example.test:8080?tls=1&%74ls=0",
    ]) {
      process.env.TURSO_DATABASE_URL = url;
      const db = createPrismaClient();
      assert.throws(() => db.$connect, /Database configuration is required in production/, url);
    }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
