import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrismaClient } from "../lib/db.ts";
import { storeJourneyRun, readCustomerJourney, readJourneySubmissions, expireCustomerSnapshots, JourneySyncRunningError } from "../lib/customer-journey-store.ts";
import { UKTL_LOCATION, UKTL_STRIPE_ACCOUNT } from "../lib/customer-journey.ts";

test("journey form reads include same-day receipts and exclude future evidence", async () => {
  const now = new Date("2026-10-16T23:30:00Z"); // already 17 October in London
  const result = await readJourneySubmissions(async path => {
    const url = new URL(path, "https://example.test");
    assert.equal(url.searchParams.get("endAt"), "2026-10-18");
    return { meta: { total: 3 }, submissions: [
      { id: "today", createdAt: "2026-10-16T11:00:00Z" },
      { id: "local-today", createdAt: "2026-10-16T23:15:00Z" },
      { id: "future", createdAt: "2026-10-17T12:00:00Z" },
    ] };
  }, { locationId: UKTL_LOCATION, formId: "verified-form", maxRecords: 100, now });
  assert.deepEqual(result.map(row => row.id), ["today", "local-today"]);
  await assert.rejects(() => readJourneySubmissions(async () => ({ meta: { total: 101 }, submissions: [] }),
    { locationId: UKTL_LOCATION, formId: "verified-form", maxRecords: 100, now }), /incomplete/);
});

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


test("snapshot retention erases expired identifiers, hides stale payloads and preserves run diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "journey-retention-")), db = createPrismaClient({ url: `file:${join(dir, "test.db")}` });
  try {
    const sql = await readFile(new URL("../prisma/migrations/20261014160000_customer_journey/migration.sql", import.meta.url), "utf8");
    for (const statement of sql.split(";").filter(s => s.trim())) await db.$executeRawUnsafe(statement);
    const now = new Date(), cutoff = new Date(+now - 30 * 86400000);
    const scope = { locationId: UKTL_LOCATION, stripeAccountId: UKTL_STRIPE_ACCOUNT };
    const expired = await db.customerJourneySyncRun.create({ data: { ...scope, status: "SUCCEEDED", startedAt: cutoff, finishedAt: cutoff, payload: "expired provider identifiers" } });
    assert.equal((await readCustomerJourney(db)).snapshot, null);
    const recent = await db.customerJourneySyncRun.create({ data: { ...scope, status: "FAILED", startedAt: now, finishedAt: now, payload: "recent payload", error: "diagnostic retained" } });
    const other = await db.customerJourneySyncRun.create({ data: { ...scope, locationId: "other-location", status: "SUCCEEDED", startedAt: cutoff, finishedAt: cutoff, payload: "outside scope" } });
    assert.equal((await expireCustomerSnapshots(db, now)).count, 1);
    assert.equal((await db.customerJourneySyncRun.findUnique({ where: { id: expired.id } })).payload, null);
    assert.equal((await db.customerJourneySyncRun.findUnique({ where: { id: recent.id } })).payload, "recent payload");
    assert.equal((await db.customerJourneySyncRun.findUnique({ where: { id: other.id } })).payload, "outside scope");
    assert.equal(await db.customerJourneySyncRun.count(), 3);
    await assert.rejects(() => storeJourneyRun(db, async () => { throw new Error("provider unavailable"); }), /provider unavailable/);
    assert.equal((await db.customerJourneySyncRun.findUnique({ where: { id: expired.id } })).payload, null);
  } finally { await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }
});
