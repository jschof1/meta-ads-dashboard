import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { LibsqlBatchError, type InStatement, type InValue } from "@libsql/client";
import { withDatabaseClient } from "@/lib/db";

type SnapshotCreates = {
  Campaign: Prisma.CampaignUncheckedCreateInput;
  AdSet: Prisma.AdSetUncheckedCreateInput;
  Ad: Prisma.AdUncheckedCreateInput;
  Creative: Prisma.CreativeUncheckedCreateInput;
  DailyInsight: Prisma.DailyInsightUncheckedCreateInput;
  CrmContact: Prisma.CrmContactUncheckedCreateInput;
  CrmOpportunity: Prisma.CrmOpportunityUncheckedCreateInput;
};
type SnapshotTable = keyof SnapshotCreates;
type Scalar = string | number | boolean | Date | null | undefined;
type Fields = Record<string, Scalar>;

const conflictColumns: Record<SnapshotTable, string[]> = {
  Campaign: ["metaId"], AdSet: ["metaId"], Ad: ["metaId"], Creative: ["metaId"],
  DailyInsight: ["date", "level", "entityId", "attributionKey", "scopeKey"],
  CrmContact: ["locationId", "highLevelId"],
  CrmOpportunity: ["locationId", "pipelineId", "highLevelId"],
};
const dateColumns = new Set(["createdAt", "updatedAt", "providerUpdatedAt", "observedAt", "finishedAt"]);
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
const defined = (fields: Fields): Fields => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

function encode(column: string, value: Scalar): InValue {
  if (value === undefined) throw new Error("Undefined snapshot value must be omitted");
  // Match PrismaLibSQL's default iso8601 encoding, including its UTC suffix.
  // CRM provider date strings and Meta date-only keys are NOT DateTime columns.
  if (value !== null && dateColumns.has(column)) {
    const date = value instanceof Date ? value : new Date(value as string);
    if (!Number.isFinite(date.getTime())) throw new Error(`Invalid snapshot date for ${column}`);
    return date.toISOString().replace("Z", "+00:00");
  }
  if (value instanceof Date) throw new Error(`Unexpected Date in snapshot column ${column}`);
  return typeof value === "boolean" ? Number(value) : value;
}

export type SnapshotLease = {
  table: "SyncRun" | "CrmSyncRun";
  id: string;
  owner: string | null;
  lockKey: string;
  completedAt: Date;
  // Only deterministic tests supply this. Production checks database wall time
  // at the FINAL statement, after the writes and any wait for the write lock.
  leaseNow?: Date;
  data: Fields;
  lostLeaseError: Error;
};

// Turso documents a five-second timeout for interactive libSQL transactions:
// https://docs.turso.tech/sdk/ts/reference#interactive-transactions
// A Prisma 45s timeout cannot extend it. A single client.batch(..., "write")
// runs on the server under BEGIN IMMEDIATE and rolls back on ANY failed step:
// https://docs.turso.tech/sdk/ts/reference#batch-transactions
// Keep field mappings at the callers; this is only the snapshot SQL writer.
export class SnapshotWriteBatch {
  private readonly statements: InStatement[] = [];
  private readonly timestamp: Date;

  constructor(timestamp = new Date()) {
    this.timestamp = new Date(timestamp);
  }

  upsert<T extends SnapshotTable>(table: T, input: { create: SnapshotCreates[T]; update: Partial<SnapshotCreates[T]> }): void {
    const create = defined(input.create as Fields);
    const update = defined(input.update as Fields);
    // Never replace an existing row (REPLACE would change identity and FKs).
    // Existing ids/createdAt survive conflicts, including historical CUIDs.
    if (create.id === undefined) create.id = randomUUID();
    if (table === "DailyInsight") {
      if (create.observedAt === undefined) create.observedAt = this.timestamp;
    } else {
      if (create.createdAt === undefined) create.createdAt = this.timestamp;
      if (create.updatedAt === undefined) create.updatedAt = this.timestamp;
      // Prisma does not advance @updatedAt for an empty update object.
      if (Object.keys(update).length > 0 && update.updatedAt === undefined) update.updatedAt = this.timestamp;
    }
    if ("id" in update || "createdAt" in update) throw new Error("Snapshot updates cannot change row identity or creation time");
    const keys = conflictColumns[table];
    if (!keys || keys.some((key) => create[key] == null)) throw new Error("Snapshot conflict key is incomplete");
    const columns = Object.keys(create);
    const updates = Object.keys(update);
    this.statements.push({
      sql: `INSERT INTO ${identifier(table)} (${columns.map(identifier).join(", ")})
        VALUES (${columns.map(() => "?").join(", ")})
        ON CONFLICT (${keys.map(identifier).join(", ")}) ${updates.length === 0 ? "DO NOTHING" :
          `DO UPDATE SET ${updates.map((column) => `${identifier(column)} = ?`).join(", ")}`}`,
      args: [...columns.map((column) => encode(column, create[column])), ...updates.map((column) => encode(column, update[column]))],
    });
  }

  async commit(db: PrismaClient, lease: SnapshotLease): Promise<void> {
    const data = defined({ ...lease.data, status: "SUCCEEDED", finishedAt: lease.completedAt, lockKey: null, lockOwner: null, lockExpiresAt: null });
    const columns = Object.keys(data);
    // Historic SQLite databases can have numeric epoch-ms or textual dates.
    // Normalize both before comparison; mixed storage classes compare wrongly.
    const expiry = `CASE WHEN typeof("lockExpiresAt") IN ('integer', 'real') THEN "lockExpiresAt"
      ELSE round((julianday("lockExpiresAt") - 2440587.5) * 86400000) END`;
    const now = lease.leaseNow ? "?" : "round((julianday('now') - 2440587.5) * 86400000)";
    const statements: InStatement[] = [...this.statements, {
      sql: `UPDATE ${identifier(lease.table)} SET ${columns.map((column) => `${identifier(column)} = ?`).join(", ")}
        WHERE "id" = ? AND "status" = 'RUNNING' AND "lockOwner" = ? AND "lockKey" = ?
        AND (${expiry}) > ${now}`,
      args: [...columns.map((column) => encode(column, data[column])), lease.id, lease.owner, lease.lockKey,
        ...(lease.leaseNow ? [lease.leaseNow.getTime()] : [])],
    }, {
      // This assertion MUST execute inside the transaction. Checking the
      // returned rowsAffected after batch() resolves would be post-commit.
      sql: "SELECT CASE WHEN changes() = 1 THEN 1 ELSE abs(-9223372036854775808) END",
    }];
    try {
      await withDatabaseClient(db, (client) => client.batch(statements, "write"));
    } catch (error) {
      if (error instanceof LibsqlBatchError && error.statementIndex === statements.length - 1
        && error.message.includes("integer overflow")) throw lease.lostLeaseError;
      throw error;
    }
  }
}
