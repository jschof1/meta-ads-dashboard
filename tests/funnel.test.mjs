import test from "node:test";
import assert from "node:assert/strict";
import { buildFunnel, rollup } from "../lib/funnel.ts";

test("keeps a terminal lost CRM status when deduping an earlier lead row", () => {
  const result = buildFunnel([
    { email: "lead@example.test", stage: "lead", leadTime: "2026-09-01T10:00:00Z" },
    { email: "LEAD@example.test", stage: "lost", leadTime: "2026-09-02T10:00:00Z" },
  ]);

  assert.equal(result.counts.duplicatesCollapsed, 1);
  assert.equal(result.counts.leads, 1);
  assert.equal(result.counts.lostCustomers, 1);
  assert.equal(result.counts.contacted, 0);
  assert.equal(result.counts.wonCustomers, 0);
  assert.equal(result.rows[0].stage, "lost");
});

test("does not turn an explicitly lost row into every earlier funnel stage", () => {
  assert.deepEqual(rollup([{ email: "lost@example.test", stage: "lost" }]), {
    leads: 1,
    contacted: 0,
    qualified: 0,
    callsBooked: 0,
    callsAttended: 0,
    wonCustomers: 0,
    lostCustomers: 1,
  });
});
