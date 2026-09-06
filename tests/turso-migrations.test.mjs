import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const fixtures = [];

async function temporaryDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-turso-migrations-"));
  const path = join(directory, "test.db");
  fixtures.push({ directory, path });
  return path;
}

function runMigration(path, overrides = {}) {
  return execFileSync(process.execPath, ["scripts/apply-turso-migrations.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      TURSO_DATABASE_URL: `file:${path}`,
      TURSO_AUTH_TOKEN: "turso-test-secret",
      TURSO_MIGRATION_CONFIRM: "yes",
      NODE_ENV: "test",
      TURSO_MIGRATION_ALLOW_LOCAL: "yes",
      ...overrides,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("applies every committed migration once and is idempotent on a second run", async () => {
  const path = await temporaryDatabase();
  const first = runMigration(path);
  assert.match(first, /Applied 7 Turso migrations\./);

  const db = createPrismaClient({ url: `file:${path}` });
  const ledger = await db.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations" ORDER BY "started_at" ASC');
  const tables = await db.$queryRawUnsafe('SELECT "name" FROM "sqlite_master" WHERE "type" = \'table\'');
  assert.equal(ledger.length, 7);
  assert.ok(tables.some((row) => row.name === "MetaAction"));
  assert.ok(tables.some((row) => row.name === "CrmOpportunity"));
  assert.ok(tables.some((row) => row.name === "AuthRateLimit"));
  await db.$disconnect();

  const second = runMigration(path);
  assert.match(second, /Turso migrations are up to date\./);
});

test("requires an explicit confirmation before opening a Turso migration connection", async () => {
  const path = await temporaryDatabase();
  assert.throws(
    () => runMigration(path, { TURSO_MIGRATION_CONFIRM: "no" }),
    /TURSO_MIGRATION_CONFIRM=yes/,
  );
});

test("rejects local database targets without the explicit test-only override", async () => {
  const path = await temporaryDatabase();
  assert.throws(
    () => runMigration(path, { NODE_ENV: "production", TURSO_MIGRATION_ALLOW_LOCAL: "" }),
    /remote libSQL URL/,
  );
});

test("does not guess a baseline for an existing application database without a ledger", async () => {
  const path = await temporaryDatabase();
  const db = createPrismaClient({ url: `file:${path}` });
  await db.$executeRawUnsafe('CREATE TABLE "Campaign" ("id" TEXT NOT NULL PRIMARY KEY)');
  await db.$disconnect();

  assert.throws(
    () => runMigration(path),
    /migration ledger is missing while application tables already exist/,
  );
  const check = createPrismaClient({ url: `file:${path}` });
  const objects = await check.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE name LIKE '%prisma_migrations%'");
  assert.deepEqual(objects, []);
  await check.$disconnect();
});

for (const [label, sql] of [
  ["unknown table", 'CREATE TABLE "LegacyOnly" ("value" TEXT)'],
  ["view only", 'CREATE VIEW "LegacyView" AS SELECT 1 AS value'],
]) {
  test(`refuses an untracked ${label} without creating ledger artifacts`, async () => {
    const path = await temporaryDatabase();
    const db = createPrismaClient({ url: `file:${path}` });
    try {
      await db.$executeRawUnsafe(sql);
      const before = await db.$queryRawUnsafe("SELECT type, name, sql FROM sqlite_master ORDER BY name");
      assert.throws(() => runMigration(path), /baseline the existing schema explicitly/);
      assert.deepEqual(await db.$queryRawUnsafe("SELECT type, name, sql FROM sqlite_master ORDER BY name"), before);
    } finally { await db.$disconnect(); }
  });
}

test("refuses a checksum-mismatched migration ledger", async () => {
  const path = await temporaryDatabase();
  runMigration(path);
  const db = createPrismaClient({ url: `file:${path}` });
  await db.$executeRawUnsafe('UPDATE "_prisma_migrations" SET "checksum" = \'invalid\' WHERE "migration_name" = \'20260905160000_pr10_production_hardening\'');
  await db.$executeRawUnsafe('DROP INDEX "_uktl_prisma_migrations_name_key"');
  const before = await db.$queryRawUnsafe("SELECT type, name, sql FROM sqlite_master ORDER BY name");
  await db.$disconnect();

  assert.throws(() => runMigration(path), /checksum mismatch/);
  const check = createPrismaClient({ url: `file:${path}` });
  assert.deepEqual(await check.$queryRawUnsafe("SELECT type, name, sql FROM sqlite_master ORDER BY name"), before);
  await check.$disconnect();
});

test("refuses incomplete and gapped migration ledgers", async () => {
  const incompletePath = await temporaryDatabase();
  runMigration(incompletePath);
  const incompleteDb = createPrismaClient({ url: `file:${incompletePath}` });
  await incompleteDb.$executeRawUnsafe('UPDATE "_prisma_migrations" SET "finished_at" = NULL WHERE "migration_name" = \'20260905160000_pr10_production_hardening\'');
  await incompleteDb.$disconnect();
  assert.throws(() => runMigration(incompletePath), /incomplete or rolled back/);

  const gappedPath = await temporaryDatabase();
  runMigration(gappedPath);
  const gappedDb = createPrismaClient({ url: `file:${gappedPath}` });
  await gappedDb.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE "migration_name" = \'20260905133000_pr08_highlevel_attribution\'');
  await gappedDb.$disconnect();
  assert.throws(() => runMigration(gappedPath), /skips an earlier migration/);
});

test("rolls back a pending migration batch without writing its ledger row", async () => {
  const path = await temporaryDatabase();
  runMigration(path);
  const db = createPrismaClient({ url: `file:${path}` });
  await db.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE "migration_name" = \'20260905160000_pr10_production_hardening\'');
  await db.$executeRawUnsafe('DROP TABLE "AuthRateLimit"');
  await db.$executeRawUnsafe('CREATE TABLE "AuthRateLimit" ("legacyId" TEXT NOT NULL PRIMARY KEY)');
  await db.$disconnect();

  assert.throws(() => runMigration(path), /Turso migration failed/);

  const checkDb = createPrismaClient({ url: `file:${path}` });
  const rows = await checkDb.$queryRawUnsafe('SELECT "migration_name" FROM "_prisma_migrations" WHERE "migration_name" = \'20260905160000_pr10_production_hardening\'');
  const columns = await checkDb.$queryRawUnsafe('PRAGMA table_info("AuthRateLimit")');
  assert.equal(rows.length, 0);
  assert.deepEqual(columns.map((row) => row.name), ["legacyId"]);
  await checkDb.$disconnect();
});

// Intercept client construction in a child process. A regression must never
// send even a synthetic token over the network, and a connection error would
// not prove that validation happened before createClient.
function runCliWithClientTrap(script, url, overrides = {}) {
  const loader = `
    export async function resolve(specifier, context, nextResolve) {
      if (specifier === "@libsql/client") return {
        shortCircuit: true,
        url: "data:text/javascript," + encodeURIComponent(
          'export function createClient() { process.stderr.write("CLIENT_CREATED\\\\n"); process.exit(97); }'
        ),
      };
      return nextResolve(specifier, context);
    }
  `;
  const program = `
    import { register } from "node:module";
    import { pathToFileURL } from "node:url";
    register("data:text/javascript," + encodeURIComponent(${JSON.stringify(loader)}), import.meta.url);
    process.argv[1] = ${JSON.stringify(join(root, script))};
    await import(pathToFileURL(process.argv[1]).href);
  `;
  const inherited = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
    .filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  return spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    cwd: root,
    env: {
      ...inherited, NODE_ENV: "production", TURSO_DATABASE_URL: url,
      TURSO_AUTH_TOKEN: "synthetic-cli-token", TURSO_MIGRATION_CONFIRM: "yes", TURSO_BASELINE_CONFIRM: "yes",
      ...overrides,
    },
    encoding: "utf8", timeout: 10_000,
  });
}

for (const script of ["scripts/apply-turso-migrations.mjs", "scripts/record-turso-baseline.mjs", "scripts/inspect-turso-schema.mjs"]) {
  test(`${script} rejects unsafe transport before constructing any client`, () => {
    const urls = [
      "http://db.example.test:8080", "http://db.example.test:8080?tls=1",
      "libsql://db.example.test:8080?tls=0", "https://db.example.test:443?tls=0",
      "libsql://db.example.test:8080?tls=1&tls=0", "libsql://db.example.test:8080?tls=0&tls=1",
      "libsql://db.example.test:8080?tls=1&tls=1", "https://db.example.test:443?tls=1&tls=1",
      "libsql://db.example.test:8080?tls=1&%74ls=0", "libsql://db.example.test:8080?%74ls=1&tls=1",
      "libsql://db.example.test:8080?tls=%31&%74%6c%73=%30", "https://db.example.test:443?tls=1&%74ls=0",
      "libsql://user:password@db.example.test:443", "https://", "https://db.example.test:443#fragment",
    ];
    for (const url of urls) {
      const result = runCliWithClientTrap(script, url);
      assert.equal(result.status, 1, `${url}: ${result.error ?? result.stderr}`);
      assert.match(result.stderr, /remote libSQL URL with TLS enabled and no duplicate TLS parameters/, url);
      assert.doesNotMatch(result.stderr, /CLIENT_CREATED|synthetic-cli-token/, url);
      assert.equal(result.stdout, "", url);
    }
  });

  test(`${script} accepts secure URLs and preserves only the explicit local test override`, () => {
    for (const url of ["https://db.example.test", "libsql://db.example.test", "https://db.example.test?tls=1", "libsql://db.example.test?%74ls=%31"]) {
      const result = runCliWithClientTrap(script, url);
      assert.equal(result.status, 97, `${url}: ${result.error ?? result.stderr}`);
      assert.match(result.stderr, /CLIENT_CREATED/);
    }
    for (const overrides of [
      { NODE_ENV: "production", TURSO_MIGRATION_ALLOW_LOCAL: "yes" },
      { NODE_ENV: "development", TURSO_MIGRATION_ALLOW_LOCAL: "yes" },
      { NODE_ENV: "test", TURSO_MIGRATION_ALLOW_LOCAL: "" },
    ]) {
      const result = runCliWithClientTrap(script, "file:must-not-be-opened.db", overrides);
      assert.equal(result.status, 1, result.error ?? result.stderr);
      assert.match(result.stderr, /remote libSQL URL with TLS enabled/);
      assert.doesNotMatch(result.stderr, /CLIENT_CREATED/);
    }
    const allowed = runCliWithClientTrap(script, "file:explicit-test.db", { NODE_ENV: "test", TURSO_MIGRATION_ALLOW_LOCAL: "yes" });
    assert.equal(allowed.status, 97, allowed.error ?? allowed.stderr);
    assert.match(allowed.stderr, /CLIENT_CREATED/);
  });
}
