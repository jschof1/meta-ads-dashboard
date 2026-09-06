import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { isSecureRemoteDatabaseUrl, readSchemaSnapshot, schemaUnchangedGuard } from "./turso-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "prisma", "migrations");

const MIGRATION_LEDGER_SQL = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "_uktl_prisma_migrations_name_key"
ON "_prisma_migrations" ("migration_name")`;

class MigrationSafetyError extends Error {}

function fail(message) {
  throw new MigrationSafetyError(message);
}

async function readMigrations() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d+_[A-Za-z0-9_-]+$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (directories.length === 0) fail("No committed Prisma migrations were found.");

  return Promise.all(directories.map(async (directory) => {
    const name = directory.name;
    const sql = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
    return {
      name,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  }));
}

function splitSqlStatements(sql) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[" ) {
      quote = "]";
      continue;
    }
    if (character === "-" && next === "-") {
      const lineEnd = sql.indexOf("\n", index + 2);
      index = lineEnd === -1 ? sql.length : lineEnd;
      continue;
    }
    if (character === "/" && next === "*") {
      const commentEnd = sql.indexOf("*/", index + 2);
      index = commentEnd === -1 ? sql.length : commentEnd + 1;
      continue;
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement.replace(/(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/g, "").trim()) statements.push(statement);
      start = index + 1;
    }
  }
  const finalStatement = sql.slice(start).trim();
  if (finalStatement.replace(/(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/g, "").trim()) statements.push(finalStatement);
  return statements;
}

function rowValue(row, key) {
  return row[key] ?? row[`_${key}`];
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function migrationIsComplete(row) {
  return hasValue(rowValue(row, "finished_at"))
    && !hasValue(rowValue(row, "rolled_back_at"))
    && Number(rowValue(row, "applied_steps_count")) >= 1;
}

async function readLedger(client) {
  const result = await client.execute(
    'SELECT "id", "checksum", "migration_name", "finished_at", "rolled_back_at", "started_at", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "started_at" ASC',
  );
  return result.rows;
}

function validateLedger(rows, migrations) {
  const byName = new Map(migrations.map((migration) => [migration.name, migration]));
  const seen = new Set();
  for (const row of rows) {
    const name = rowValue(row, "migration_name");
    const checksum = rowValue(row, "checksum");
    if (typeof name !== "string" || !byName.has(name)) {
      fail("The Turso migration ledger contains a migration that is not present in this checkout.");
    }
    if (seen.has(name)) fail("The Turso migration ledger contains a duplicate migration.");
    seen.add(name);
    if (!migrationIsComplete(row)) {
      fail(`Migration ${name} is incomplete or rolled back; repair the database before continuing.`);
    }
    if (checksum !== byName.get(name).checksum) {
      fail(`Migration ${name} has a checksum mismatch; restore the matching migration source before continuing.`);
    }
  }
  const appliedIndexes = migrations
    .map((migration, index) => seen.has(migration.name) ? index : null)
    .filter((index) => index !== null);
  const highestAppliedIndex = appliedIndexes.at(-1);
  if (highestAppliedIndex != null && appliedIndexes.length !== highestAppliedIndex + 1) {
    fail("The Turso migration ledger skips an earlier migration; repair the ledger before continuing.");
  }
}

async function applyMigration(client, migration) {
  const startedAt = new Date().toISOString();
  const statements = splitSqlStatements(migration.sql).map((sql) => ({ sql }));
  statements.push({
    sql: `INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), migration.checksum, new Date().toISOString(), migration.name, startedAt, 1],
  });
  await client.batch(statements, "write");
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) fail("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  if (process.env.TURSO_MIGRATION_CONFIRM !== "yes") {
    fail("Set TURSO_MIGRATION_CONFIRM=yes only after taking a recoverable database backup.");
  }
  const isExplicitTestOverride = process.env.NODE_ENV === "test"
    && process.env.TURSO_MIGRATION_ALLOW_LOCAL === "yes" && url.startsWith("file:");
  if (!isSecureRemoteDatabaseUrl(url) && !isExplicitTestOverride) {
    fail("TURSO_DATABASE_URL must be a valid remote libSQL URL with TLS enabled and no duplicate TLS parameters.");
  }

  const migrations = await readMigrations();
  const client = createClient({ url, authToken });
  try {
    const schema = await readSchemaSnapshot(client);
    const ledgerExisted = schema.objects.some((object) => object.type === "table" && object.name === "_prisma_migrations");
    if (!ledgerExisted && schema.objects.some((object) => !object.name.startsWith("sqlite_"))) {
      fail("The Turso migration ledger is missing while application tables already exist or other schema objects are present; baseline the existing schema explicitly before applying pending migrations.");
    }

    const ledger = ledgerExisted ? await readLedger(client) : [];
    validateLedger(ledger, migrations);
    if (!ledgerExisted) {
      await client.batch([
        schemaUnchangedGuard(schema),
        MIGRATION_LEDGER_SQL.replace(" IF NOT EXISTS", ""),
        MIGRATION_NAME_INDEX_SQL.replace(" IF NOT EXISTS", ""),
      ], "write");
    } else {
      await client.execute(MIGRATION_NAME_INDEX_SQL);
    }
    const applied = new Set(ledger.map((row) => rowValue(row, "migration_name")));
    const pending = migrations.filter((migration) => !applied.has(migration.name));

    for (const migration of pending) {
      await applyMigration(client, migration);
      console.log(`Applied ${migration.name}`);
    }
    if (pending.length === 0) console.log("Turso migrations are up to date.");
    else console.log(`Applied ${pending.length} Turso migration${pending.length === 1 ? "" : "s"}.`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof MigrationSafetyError
    ? error.message
    : "Turso migration failed; inspect the migration ledger and provider state before retrying.");
  process.exitCode = 1;
});
