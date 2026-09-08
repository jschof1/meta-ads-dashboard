import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/db.ts";

test("Cloudflare requests receive separate database clients while one request reuses its client", async () => {
  // This is the context hook used by the installed OpenNext adapter.
  const key = Symbol.for("__cloudflare-context__");
  const previous = globalThis[key];
  const first = { env: {}, ctx: {} };
  const second = { env: {}, ctx: {} };
  const disconnect = [];
  try {
    globalThis[key] = first;
    const firstModel = prisma.campaign;
    disconnect.push(prisma.$disconnect);
    assert.ok(firstModel);
    assert.equal(prisma.campaign, firstModel);
    globalThis[key] = second;
    assert.notEqual(prisma.campaign, firstModel);
    disconnect.push(prisma.$disconnect);
    globalThis[key] = first;
    assert.equal(prisma.campaign, firstModel);
  } finally {
    if (previous === undefined) delete globalThis[key];
    else globalThis[key] = previous;
    await Promise.all(disconnect.map((close) => close()));
  }
});
