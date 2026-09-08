// Opt-in, billable provider-contract check. Only synthetic fixture data is used;
// it does not validate production Meta performance or connect a production DB.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { createPrismaClient } from "../lib/db.ts";
import { buildDashboardState } from "../lib/read-model.ts";
import { generateAndPersistAiBriefing } from "../lib/ai-service.ts";
import { readCommittedMigrations, splitSqlStatements } from "./turso-schema.mjs";

const fixtureOnly = process.argv.includes("--fixture-only");
if (!fixtureOnly && (process.env.ANTHROPIC_VALIDATION_CONFIRM !== "yes" || !process.env.ANTHROPIC_API_KEY?.trim())) {
  console.error("Set ANTHROPIC_VALIDATION_CONFIRM=yes and a server-side ANTHROPIC_API_KEY for this billable synthetic-data check.");
  process.exit(1);
}

const directory = await mkdtemp(join(tmpdir(), "uktl-ai-validation-"));
const url = `file:${join(directory, "fixture.db")}`;
const sql = createClient({ url });
const db = createPrismaClient({ url, authToken: "" });
let stage = "migrations";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    const response = await originalFetch(...args);
    const data = await response.clone().json().catch(() => null);
    const message = String(data?.error?.message ?? "");
    console.log(JSON.stringify({ providerHttpStatus: response.status, stopReason: data?.stop_reason, outputTokens: data?.usage?.output_tokens, schemaRejected: /schema|output_config|structured/i.test(message), billingRejected: /credit|billing|balance/i.test(message) }));
    return response;
  } catch (error) {
    console.log(JSON.stringify({ transportFailure: error instanceof Error ? error.constructor.name : "unknown" }));
    throw error;
  }
};
try {
  const migrations = await readCommittedMigrations(new URL("../prisma/migrations", import.meta.url).pathname);
  for (const migration of migrations) await sql.batch(splitSqlStatements(migration.sql), "write");
  stage = "fixture";
  const now = new Date();
  const accountId = "act_synthetic_ai_validation";
  process.env.META_AD_ACCOUNT_ID = accountId;
  process.env.META_CAMPAIGN_ID = "";
  process.env.META_ATTRIBUTION_WINDOWS = "7d_click,1d_view";
  process.env.HIGHLEVEL_SYNC_ENABLED = "false";
  process.env.META_WRITES_ENABLED = "false";
  const run = await db.syncRun.create({ data: {
    accountId, accountName: "Synthetic contract-test fixture, not business performance",
    trigger: "synthetic-provider-validation", status: "SUCCEEDED",
    currencyCode: "GBP", timezoneName: "UTC", attributionKey: "7d_click,1d_view",
    startedAt: now, finishedAt: now,
  } });
  await db.dailyInsight.create({ data: {
    date: now.toISOString().slice(0, 10), level: "account", entityId: accountId,
    attributionKey: "7d_click,1d_view", scopeKey: "account", currencyCode: "GBP",
    spendMinorUnits: 10_000, impressions: 1_000, leads: 2, linkClicks: 20,
    resultActionType: "lead", syncRunId: run.id,
  } });
  const state = await buildDashboardState({ db, now });
  assert.equal(state.meta.lastSuccessfulSyncRunId, run.id);
  assert.equal(state.scorecard.last7.spendCents, 10_000);
  assert.equal(state.scorecard.last7.leads, 2);
  if (fixtureOnly) {
    console.log(JSON.stringify({ validation: "synthetic-only", status: "fixture-ready", attributionWindows: process.env.META_ATTRIBUTION_WINDOWS, providerCalled: false }));
  } else {
    stage = "provider";
    const result = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: process.env.ANTHROPIC_API_KEY });
    assert.ok(result);
    assert.equal(await db.aiBriefing.count(), 1);
    console.log(JSON.stringify({ validation: "synthetic-only", status: "passed", kind: "summary", model: result.model, persisted: true, evidenceValidated: true }));
  }
} catch (error) {
  // Neither provider error bodies nor generated business-looking text belong in logs.
  console.error(JSON.stringify({ validation: "synthetic-only", status: "failed", stage, category: error instanceof Error ? error.constructor.name : "unknown" }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = originalFetch;
  await db.$disconnect();
  sql.close();
  await rm(directory, { recursive: true, force: true });
}
