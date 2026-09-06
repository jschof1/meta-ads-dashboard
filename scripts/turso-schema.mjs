import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
export { isSecureRemoteDatabaseUrl } from "../lib/database-url.mjs";

export function rowValue(row, key) {
  return row[key] ?? row[`_${key}`];
}

export function quoteIdentifier(value) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

export function normalizeSql(sql) {
  // Deliberately conservative: whitespace in literals, quoted identifiers and
  // line comments is meaningful. Formatting-only differences require review.
  return String(sql ?? "").trim();
}

const CATALOG_SQL = `SELECT json_group_array(json_array(type, name, tbl_name, rootpage, sql)) AS catalog
  FROM (SELECT type, name, tbl_name, rootpage, sql FROM main.sqlite_master ORDER BY type, name)`;

// Include internal objects and ledger objects here, even though they are not
// application tables. The schema cookie also catches create/drop ABA changes.
export function schemaUnchangedGuard(snapshot) {
  return {
    sql: `SELECT CASE WHEN (${CATALOG_SQL}) = ?
      AND (SELECT schema_version FROM pragma_schema_version) = ?
      THEN 1 ELSE abs(-9223372036854775808) END AS schema_unchanged`,
    args: [snapshot.catalog, snapshot.schemaVersion],
  };
}

export async function readCommittedMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d+_[A-Za-z0-9_-]+$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (directories.length === 0) throw new Error("No committed Prisma migrations were found.");

  return Promise.all(directories.map(async (directory) => {
    const name = directory.name;
    const sql = await readFile(join(migrationsDirectory, name, "migration.sql"), "utf8");
    return { name, sql };
  }));
}

export function splitSqlStatements(sql) {
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
    if (character === "[") {
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

function readTableSchema(name, sql, metadata, objects) {
  const rowsForTable = (rows) => rows.filter((row) => rowValue(row, "table_name") === name);
  const columns = rowsForTable(metadata.columns);
  const indexList = rowsForTable(metadata.indexes);
  const indexes = [];
  for (const row of indexList) {
    const indexName = String(rowValue(row, "name"));
    const indexInfo = metadata.indexColumns.filter((column) => rowValue(column, "index_name") === indexName);
    indexes.push({
      name: indexName,
      sql: objects.find((object) => object.type === "index" && object.name === indexName)?.sql ?? null,
      unique: Number(rowValue(row, "unique")),
      partial: Number(rowValue(row, "partial")),
      origin: String(rowValue(row, "origin")),
      columns: indexInfo
        .map((column) => ({
          seq: Number(rowValue(column, "seqno")),
          cid: Number(rowValue(column, "cid")),
          name: rowValue(column, "name") == null ? null : String(rowValue(column, "name")),
          collation: rowValue(column, "coll"),
          descending: Number(rowValue(column, "desc")),
          key: Number(rowValue(column, "key")),
        }))
        .sort((left, right) => left.seq - right.seq),
    });
  }

  const foreignKeys = rowsForTable(metadata.foreignKeys)
    .map((row) => ({
      id: Number(rowValue(row, "id")),
      seq: Number(rowValue(row, "seq")),
      table: String(rowValue(row, "table")),
      from: String(rowValue(row, "from")),
      to: String(rowValue(row, "to")),
      onUpdate: String(rowValue(row, "on_update")),
      onDelete: String(rowValue(row, "on_delete")),
      match: String(rowValue(row, "match")),
    }))
    .sort((left, right) => left.id - right.id || left.seq - right.seq);

  return {
    name,
    sql: normalizeSql(sql),
    columns: columns.map((row) => ({
      name: String(rowValue(row, "name")),
      type: String(rowValue(row, "type")),
      notNull: Number(rowValue(row, "notnull")),
      defaultValue: rowValue(row, "dflt_value") == null ? null : String(rowValue(row, "dflt_value")),
      primaryKeyPosition: Number(rowValue(row, "pk")),
      hidden: Number(rowValue(row, "hidden")),
    })),
    indexes: indexes.sort((left, right) => left.name.localeCompare(right.name)),
    foreignKeys,
  };
}

export async function readSchemaSnapshot(client) {
  // One read batch gives a coherent snapshot without an interactive transaction.
  const [catalogResult, versionResult, columns, indexes, indexColumns, foreignKeys] = await client.batch([
    CATALOG_SQL,
    "SELECT schema_version FROM pragma_schema_version",
    `SELECT m.name AS table_name, p.* FROM main.sqlite_master m, pragma_table_xinfo(m.name) p
      WHERE m.type = 'table' ORDER BY m.name, p.cid`,
    `SELECT m.name AS table_name, p.* FROM main.sqlite_master m, pragma_index_list(m.name) p
      WHERE m.type = 'table' ORDER BY m.name, p.name`,
    `SELECT m.name AS index_name, p.* FROM main.sqlite_master m, pragma_index_xinfo(m.name) p
      WHERE m.type = 'index' ORDER BY m.name, p.seqno`,
    `SELECT m.name AS table_name, p.* FROM main.sqlite_master m, pragma_foreign_key_list(m.name) p
      WHERE m.type = 'table' ORDER BY m.name, p.id, p.seq`,
  ], "read");
  const catalog = String(rowValue(catalogResult.rows[0], "catalog"));
  const objects = JSON.parse(catalog).map(([type, name, tableName, , sql]) => ({ type, name, tableName, sql }));
  const metadata = { columns: columns.rows, indexes: indexes.rows, indexColumns: indexColumns.rows, foreignKeys: foreignKeys.rows };
  const tables = [];
  for (const { type, name, sql } of objects) {
    if (type !== "table") continue;
    if (name === "_prisma_migrations" || name.startsWith("sqlite_")) continue;
    tables.push(readTableSchema(name, sql, metadata, objects));
  }
  return { tables, objects, catalog, schemaVersion: Number(rowValue(versionResult.rows[0], "schema_version")) };
}

function comparableTable(table) {
  return {
    name: table.name,
    sql: normalizeSql(table.sql),
    columns: table.columns,
    indexes: table.indexes,
    foreignKeys: table.foreignKeys,
  };
}

export function schemaDifferences(expected, actual) {
  const differences = [];
  // Include views, triggers and standalone indexes (including ledger triggers).
  // Only the ledger table and its indexes are bookkeeping, not application DDL.
  const applicationObjects = (snapshot) => snapshot.objects.filter((object) =>
    !object.name.startsWith("sqlite_")
    && !(object.tableName === "_prisma_migrations" && ["table", "index"].includes(object.type)));
  const expectedObjects = new Map(applicationObjects(expected).map((object) => [`${object.type} ${object.name}`, object]));
  const actualObjects = new Map(applicationObjects(actual).map((object) => [`${object.type} ${object.name}`, object]));
  for (const [key, object] of expectedObjects) {
    if (!actualObjects.has(key)) differences.push(`missing ${key}`);
    else if (JSON.stringify(object) !== JSON.stringify(actualObjects.get(key))) differences.push(`${key} differs in stored SQL or owning table`);
  }
  for (const key of actualObjects.keys()) {
    if (!expectedObjects.has(key)) differences.push(`unexpected ${key}`);
  }
  const expectedByName = new Map(expected.tables.map((table) => [table.name, table]));
  const actualByName = new Map(actual.tables.map((table) => [table.name, table]));

  for (const name of expectedByName.keys()) {
    if (!actualByName.has(name)) differences.push(`missing table ${name}`);
  }
  for (const name of actualByName.keys()) {
    if (!expectedByName.has(name)) differences.push(`unexpected table ${name}`);
  }
  for (const [name, expectedTable] of expectedByName) {
    const actualTable = actualByName.get(name);
    if (!actualTable) continue;
    if (JSON.stringify(comparableTable(expectedTable)) !== JSON.stringify(comparableTable(actualTable))) {
      differences.push(`table ${name} differs in SQL, columns, indexes, or foreign keys`);
    }
  }
  return differences;
}

export async function createExpectedSchema(migrationsDirectory, migrationsOverride = null) {
  const directory = await mkdtemp(join(tmpdir(), "uktl-expected-schema-"));
  const path = join(directory, "expected.db");
  const client = createClient({ url: `file:${path}` });
  try {
    const migrations = migrationsOverride ?? await readCommittedMigrations(migrationsDirectory);
    for (const migration of migrations) {
      await client.batch(splitSqlStatements(migration.sql).map((sql) => ({ sql })), "write");
    }
    return await readSchemaSnapshot(client);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
}
