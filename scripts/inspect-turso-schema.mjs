import { createClient } from "@libsql/client";
import {
  createExpectedSchema,
  isSecureRemoteDatabaseUrl,
  normalizeSql,
  readCommittedMigrations,
  readSchemaSnapshot,
  rowValue,
  schemaDifferences,
} from "./turso-schema.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = join(root, "prisma", "migrations");

class ConfigurationError extends Error {}

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw new ConfigurationError("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required.");
  const isLocalTest = process.env.NODE_ENV === "test"
    && process.env.TURSO_MIGRATION_ALLOW_LOCAL === "yes" && url.startsWith("file:");
  if (!isSecureRemoteDatabaseUrl(url) && !isLocalTest) {
    throw new ConfigurationError("TURSO_DATABASE_URL must be a valid remote libSQL URL with TLS enabled and no duplicate TLS parameters.");
  }

  const client = createClient({ url, authToken });
  try {
    const schema = await readSchemaSnapshot(client);
    const tables = schema.objects.filter((object) => object.type === "table").map((object) => object.name);
    console.log(`Tables (${tables.length}): ${tables.join(", ") || "none"}`);
    console.log(`Migration ledger: ${tables.includes("_prisma_migrations") ? "present" : "missing"}`);

    for (const table of schema.tables) {
      console.log(`Table ${table.name}: ${normalizeSql(table.sql)}`);
      console.log(`  Columns: ${table.columns.map((column) => `${column.name} ${column.type} notNull=${column.notNull} default=${column.defaultValue ?? "NULL"} pk=${column.primaryKeyPosition}`).join("; ")}`);
      for (const index of table.indexes) {
        console.log(`  Index ${index.name}: unique=${index.unique} partial=${index.partial} origin=${index.origin} SQL=${index.sql ?? "<implicit>"}`);
        console.log(`    Columns: ${index.columns.map((column) => `${column.name ?? "<expression/rowid>"} collate=${column.collation} ${column.descending ? "DESC" : "ASC"} key=${column.key}`).join("; ")}`);
      }
      console.log(`  Foreign keys: ${table.foreignKeys.map((foreignKey) => `${foreignKey.from}->${foreignKey.table}.${foreignKey.to} onUpdate=${foreignKey.onUpdate} onDelete=${foreignKey.onDelete}`).join("; ") || "none"}`);
    }
    for (const object of schema.objects.filter((object) => !["table", "index"].includes(object.type))) {
      console.log(`${object.type} ${object.name}: ${object.sql}`);
    }

    const migrations = await readCommittedMigrations(migrationsDirectory);
    const through = process.env.TURSO_BASELINE_THROUGH?.trim() || migrations.at(-1).name;
    const throughIndex = migrations.findIndex((migration) => migration.name === through);
    if (throughIndex === -1) throw new ConfigurationError("TURSO_BASELINE_THROUGH must name a committed migration.");
    const expectedSchema = await createExpectedSchema(migrationsDirectory, migrations.slice(0, throughIndex + 1));
    const differences = schemaDifferences(expectedSchema, schema);
    if (differences.length === 0) console.log(`Schema compatibility: compatible through ${through}.`);
    else {
      console.log("Schema compatibility: mismatch; do not record a baseline.");
      for (const difference of differences) console.log(`Schema difference: ${difference}`);
      process.exitCode = 2;
    }

    if (tables.includes("_prisma_migrations")) {
      const ledger = await client.execute('SELECT "migration_name", "checksum", "finished_at", "rolled_back_at", "applied_steps_count" FROM "_prisma_migrations" ORDER BY "started_at" ASC');
      for (const row of ledger.rows) {
        console.log(`Migration ${String(rowValue(row, "migration_name"))}: checksum=${String(rowValue(row, "checksum"))} finished=${String(rowValue(row, "finished_at"))} rolled_back=${String(rowValue(row, "rolled_back_at"))} steps=${String(rowValue(row, "applied_steps_count"))}`);
      }
    }
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigurationError
    ? error.message
    : "Turso schema inspection failed; inspect the provider console for connection details.");
  process.exitCode = 1;
});
