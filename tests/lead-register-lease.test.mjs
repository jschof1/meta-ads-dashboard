import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@libsql/client";
import { releaseLeadRegisterSyncLease, tryAcquireLeadRegisterSyncLease } from "../lib/lead-register.ts";

const fixtures = [];
async function database() {
  const directory = await mkdtemp(join(tmpdir(), "meta-lead-register-lease-"));
  fixtures.push(directory);
  const db = createClient({ url: `file:${join(directory, "test.db")}` });
  await db.execute(`CREATE TABLE "LeadRegisterSyncLease" (
    "locationId" TEXT NOT NULL PRIMARY KEY,
    "owner" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
  )`);
  return db;
}

afterEach(async () => {
  while (fixtures.length) await rm(fixtures.pop(), { recursive: true, force: true });
});

test("only one simultaneous lead-register run acquires a location lease", async () => {
  const db = await database();
  try {
    const [first, second] = await Promise.all([
      tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-1", new Date("2026-10-04T12:00:00Z")),
      tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-2", new Date("2026-10-04T12:00:00Z")),
    ]);
    assert.equal(Number(first) + Number(second), 1);
    const winner = first ? "owner-1" : "owner-2";
    await releaseLeadRegisterSyncLease(db, "location-1", "wrong-owner");
    assert.equal(await tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-3", new Date("2026-10-04T12:00:30Z")), false);
    await releaseLeadRegisterSyncLease(db, "location-1", winner);
    assert.equal(await tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-3", new Date("2026-10-04T12:00:30Z")), true);
  } finally { await db.close(); }
});

test("an abandoned lease can be acquired after its expiry", async () => {
  const db = await database();
  try {
    assert.equal(await tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-1", new Date("2026-10-04T12:00:00Z")), true);
    assert.equal(await tryAcquireLeadRegisterSyncLease(db, "location-1", "owner-2", new Date("2026-10-04T12:03:00Z")), true);
  } finally { await db.close(); }
});
