import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  createExpectedSchema,
  isSecureRemoteDatabaseUrl,
  readCommittedMigrations,
  readSchemaSnapshot,
  schemaDifferences,
  schemaUnchangedGuard,
} from "./turso-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "prisma", "migrations");
const MIGRATION_LEDGER_SQL = `
CREATE TABLE "_prisma_migrations" (
  "id" VARCHAR(36) NOT NULL PRIMARY KEY,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" DATETIME,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;
const MIGRATION_NAME_INDEX_SQL = `
CREATE UNIQUE INDEX "_uktl_prisma_migrations_name_key"
ON "_prisma_migrations" ("migration_name")`;

class BaselineSafetyError extends Error {}

function fail(message) {
  throw new BaselineSafetyError(message);
}

function isAllowedTestTarget(url) {
  return process.env.NODE_ENV === "test"
    && process.env.TURSO_MIGRATION_ALLOW_LOCAL === "yes"
    && url.startsWith("file:");
}

function baselineId(name) {
  const digest = createHash("sha256").update(`uktl-baseline:${name}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) fail("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  if (!isSecureRemoteDatabaseUrl(url) && !isAllowedTestTarget(url)) {
    fail("TURSO_DATABASE_URL must be a valid remote libSQL URL with TLS enabled and no duplicate TLS parameters.");
  }
  if (process.env.TURSO_MIGRATION_CONFIRM !== "yes") {
    fail("Set TURSO_MIGRATION_CONFIRM=yes only after taking a recoverable database backup.");
  }
  if (process.env.TURSO_BASELINE_CONFIRM !== "yes") {
    fail("Set TURSO_BASELINE_CONFIRM=yes only after reviewing the complete schema inspection.");
  }

  const client = createClient({ url, authToken });
  try {
    const result = await recordBaseline(client, process.env.TURSO_BASELINE_THROUGH?.trim());
    console.log(`Recorded baseline ledger through ${result.through} for ${result.count} migrations.`);
  } finally {
    client.close();
  }
}

export async function recordBaseline(client, requestedThrough) {
  const migrations = await readCommittedMigrations(migrationsDirectory);
  const through = requestedThrough || migrations.at(-1).name;
  const throughIndex = migrations.findIndex((migration) => migration.name === through);
  if (throughIndex === -1) fail("TURSO_BASELINE_THROUGH must name a committed migration.");
  const migrationsToRecord = migrations.slice(0, throughIndex + 1);
  const actualSchema = await readSchemaSnapshot(client);
  if (actualSchema.objects.some((object) => object.name.toLowerCase() === "_prisma_migrations")) {
    fail("The Turso migration ledger already exists; use the normal migration command instead.");
  }

  const expectedSchema = await createExpectedSchema(migrationsDirectory, migrationsToRecord);
  const differences = schemaDifferences(expectedSchema, actualSchema);
  if (differences.length > 0) {
    fail(`The existing Turso schema does not match committed migrations; do not baseline. ${differences[0]}`);
  }

  const appliedAt = new Date().toISOString();
  const statements = [
    // A false guard raises integer overflow, aborting the batch before DDL.
    // libSQL's write batch acquires the write lock before this check and holds
    // it through ledger creation and inserts. No interactive timeout window.
    schemaUnchangedGuard(actualSchema),
    { sql: MIGRATION_LEDGER_SQL },
    { sql: MIGRATION_NAME_INDEX_SQL },
    ...migrationsToRecord.map((migration) => ({
      sql: `INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        baselineId(migration.name),
        createHash("sha256").update(migration.sql).digest("hex"),
        appliedAt,
        migration.name,
        appliedAt,
        1,
      ],
    })),
  ];
  await client.batch(statements, "write");
  return { through, count: migrationsToRecord.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error instanceof BaselineSafetyError
    ? error.message
    : "Turso baseline failed; schema/ledger may have changed or the write failed. Re-inspect before retrying.");
  process.exitCode = 1;
});
