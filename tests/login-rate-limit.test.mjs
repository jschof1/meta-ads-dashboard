import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { checkLoginRateLimit, clearLoginRateLimit } from "../lib/login-rate-limit.ts";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const fixtures = [];
const secret = "rate-limit-test-secret";

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-login-rate-limit-"));
  const path = join(directory, "test.db");
  fixtures.push({ directory, path });
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: root,
    env: { ...process.env, RUST_LOG: "info", DATABASE_URL: `file:${path}`, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" },
    stdio: "ignore",
  });
  return { path, db: createPrismaClient({ url: `file:${path}` }) };
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("shares an atomic five-attempt window across concurrent callers", async () => {
  const { db } = await temporaryDatabase();
  const now = new Date("2026-09-05T12:00:00.000Z");
  const results = await Promise.all(Array.from({ length: 8 }, () => checkLoginRateLimit({ key: "198.51.100.44", secret, db, now })));
  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.equal(results.filter((result) => !result.allowed).length, 3);
  await clearLoginRateLimit({ key: "198.51.100.44", secret, db });
  const afterClear = await checkLoginRateLimit({ key: "198.51.100.44", secret, db, now });
  assert.equal(afterClear.allowed, true);
  await db.$disconnect();
});

test("does not persist the source key and resets the window after expiry", async () => {
  const { db } = await temporaryDatabase();
  const key = "198.51.100.45";
  const first = new Date("2026-09-05T12:00:00.000Z");
  await checkLoginRateLimit({ key, secret, db, now: first });
  const rows = await db.$queryRawUnsafe('SELECT "keyHash", "count" FROM "AuthRateLimit"');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].keyHash, key);
  const expired = await checkLoginRateLimit({ key, secret, db, now: new Date(first.getTime() + 15 * 60 * 1_000 + 1) });
  assert.equal(expired.allowed, true);
  await db.$disconnect();
});
