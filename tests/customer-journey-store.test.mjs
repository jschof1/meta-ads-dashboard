import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient } from "../lib/db.ts";
import { storeJourneyRun, readCustomerJourney, JourneySyncRunningError } from "../lib/customer-journey-store.ts";
import { UKTL_LOCATION, UKTL_STRIPE_ACCOUNT } from "../lib/customer-journey.ts";

test("customer snapshots survive partial reads and reject overlapping writers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "journey-store-")), db = createPrismaClient({ url: `file:${join(dir, "test.db")}` });
  try {
    const sql = await readFile(new URL("../prisma/migrations/20261014160000_customer_journey/migration.sql", import.meta.url), "utf8");
    for (const statement of sql.split(";").filter(s => s.trim())) await db.$executeRawUnsafe(statement);
    const snapshot = { version: 1, accountId: UKTL_STRIPE_ACCOUNT, locationId: UKTL_LOCATION, checkedAt: new Date().toISOString(), calendarSince: "2026-01-01", qualificationConfigured: false, contacts: [], charges: [], subscriptions: [], health: { unmatchedCustomers: 0, ambiguousCustomers: 0, unmappedAdContacts: 0, attributionConflicts: 0, unmatchedCharges: 0 } };
    await storeJourneyRun(db, async () => snapshot);
    await assert.rejects(() => storeJourneyRun(db, async () => { throw new Error("Provider truncated page"); }), /truncated/);
    assert.deepEqual((await readCustomerJourney(db)).snapshot, snapshot);
    assert.equal((await readCustomerJourney(db)).attempt.status, "FAILED");
    let release, started;
    const ready = new Promise(resolve => { started = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    const writer = storeJourneyRun(db, async previous => { assert.deepEqual(previous, snapshot); started(); await held; return snapshot; });
    await ready;
    try { await assert.rejects(() => storeJourneyRun(db, async () => snapshot), JourneySyncRunningError); }
    finally { release(); await writer; }
    assert.equal(await db.customerJourneySyncRun.count({ where: { status: "SUCCEEDED" } }), 2);
    assert.equal(await db.customerJourneySyncRun.count({ where: { lockKey: { not: null } } }), 0);
    await assert.rejects(() => storeJourneyRun(db, async () => ({ ...snapshot, locationId: "wrong" })), /mismatch/);
    assert.deepEqual((await readCustomerJourney(db)).snapshot, snapshot);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
