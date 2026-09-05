import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPrismaClient } from "../lib/db.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";
import {
  MEDIA_DISCLOSURE,
  buildAiBriefingContext,
  formatAiContextForTest,
  parseAiBriefingOutput,
} from "../lib/ai-briefings.ts";
import {
  AiBriefingInputError,
  AiBriefingProviderError,
  AiBriefingRateLimitError,
  AiBriefingValidationError,
  generateAndPersistAiBriefing,
  readStoredAiBriefing,
} from "../lib/ai-service.ts";
import { persistAiBriefing } from "../lib/ai-briefing-store.ts";

const migrationPaths = [
  new URL("../prisma/migrations/20260904170000_pr03_sync_data/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904193000_pr05_operator_dashboard/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260904210000_pr06_recommendation_engine/migration.sql", import.meta.url),
  new URL("../prisma/migrations/20260905120000_pr07_ai_briefings/migration.sql", import.meta.url),
];
const fixtures = [];

async function createDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "meta-ads-pr07-"));
  const path = join(directory, "test.db");
  const db = createPrismaClient({ url: `file:${path}` });
  for (const migrationPath of migrationPaths) {
    const migration = await readFile(migrationPath, "utf8");
    const statements = migration.split(/;\s*(?:\n|$)/g).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  }
  await db.syncRun.create({
    data: {
      id: "sync-1",
      accountId: "act_uktl-test",
      campaignId: "campaign-1",
      attributionKey: "7d_click,1d_view",
      trigger: "manual",
      status: "SUCCEEDED",
      startedAt: new Date("2026-09-04T11:59:00.000Z"),
      finishedAt: new Date("2026-09-04T12:00:00.000Z"),
    },
  });
  fixtures.push({ db, directory, path });
  return { db, path };
}

afterEach(async () => {
  while (fixtures.length > 0) {
    const fixture = fixtures.pop();
    await fixture.db.$disconnect();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

function bucket(overrides = {}) {
  return {
    spendCents: 12_345,
    impressions: 10_000,
    linkClicks: 500,
    leads: 5,
    cplCents: 2_469,
    cpcCents: 247,
    ctrLink: 0.05,
    cpmCents: 1_235,
    frequency: 1.4,
    ...overrides,
  };
}

function periods(current = bucket(), previous = bucket({ spendCents: 10_000, leads: 4, cplCents: 2_500 })) {
  return {
    today: current,
    yesterday: previous,
    mtd: current,
    previousMtd: previous,
    last7: current,
    previous7: previous,
    last14: current,
    previous14: previous,
    last30: current,
    previous30: previous,
  };
}

function evidenceByPeriod() {
  return {
    today: { status: "sufficient", reason: "Stored sample is sufficient." },
    "7d": { status: "sufficient", reason: "Stored sample is sufficient." },
    "14d": { status: "sufficient", reason: "Stored sample is sufficient." },
    "30d": { status: "sufficient", reason: "Stored sample is sufficient." },
    mtd: { status: "sufficient", reason: "Stored sample is sufficient." },
  };
}

function makeState() {
  const current = bucket();
  const previous = bucket({ spendCents: 10_000, leads: 4, cplCents: 2_500, ctrLink: 0.04 });
  const adPeriods = periods(current, previous);
  const ad = {
    adId: "ad-1",
    adName: "Trusted local trades angle",
    status: "ACTIVE",
    isCurrent: true,
    thumbnailUrl: "https://cdn.example.test/thumb.jpg?token=should-not-be-forwarded",
    imageUrl: "https://cdn.example.test/image.jpg?signature=removed",
    videoId: "video-1",
    creativeId: "creative-1",
    format: "Static",
    title: "Get more trade leads",
    body: "A practical route to better local enquiries.",
    callToAction: "LEARN_MORE",
    destinationUrl: "https://uktl.example.test/book?utm_source=meta",
    imageHash: "image-hash-1",
    objectId: "object-1",
    urlTags: "utm_source=meta&access_token=should-not-be-forwarded",
    lastChangeAt: "2026-09-03T10:00:00.000Z",
    campaignId: "campaign-1",
    adSetId: "adset-1",
    periods: adPeriods,
    evidence: evidenceByPeriod(),
    evidenceStatus: "sufficient",
    spendCents: current.spendCents,
    impressions: current.impressions,
    linkClicks: current.linkClicks,
    ctrLink: current.ctrLink,
    leads: current.leads,
    cplCents: current.cplCents,
    frequency: current.frequency,
    verdict: "performing",
    verdictReason: "Stored sample is sufficient for comparison.",
    firstSeenDate: "2026-08-20",
    daysActive: 15,
    fatigueScore: 0.2,
    fatigueReason: "No fatigue warning.",
  };
  const recommendation = {
    id: "recommendation-1",
    fingerprint: "act_uktl-test|campaign-1|7d_click,1d_view|monitor:ad-1",
    accountId: "act_uktl-test",
    campaignId: "campaign-1",
    attributionKey: "7d_click,1d_view",
    type: "monitor",
    analysisWindowDays: 7,
    ruleVersion: "pr06.v1",
    target: { type: "ad", id: "ad-1", name: ad.adName },
    severity: "watch",
    confidence: "medium",
    lifecycle: "OPEN",
    reason: "Monitor the current matched-period change.",
    evidence: {
      confidenceScore: 72,
      confidenceFactors: { sampleSizeSufficient: true, seriesSufficient: true },
      sampleSize: 7,
      seriesPoints: 7,
      current: current,
      previous,
      deltas: { spendPct: 0.2, leadsPct: 0.25, cplPct: -0.02, ctrPct: 0.25, frequencyPct: 0.1 },
      notes: ["No customer outcome is available."],
    },
    proposedAction: "Review the next matched period before changing the ad.",
    sourceSyncRunId: "sync-1",
    firstSeenAt: "2026-09-04T12:00:00.000Z",
    lastSeenAt: "2026-09-04T12:00:00.000Z",
    resolvedAt: null,
  };
  return {
    meta: {
      adAccountId: "act_uktl-test",
      accountName: "UK Trade Leads",
      campaignId: "campaign-1",
      launchDate: "2026-08-20",
      daysSinceLaunch: 15,
      currencyCode: "GBP",
      timezoneName: "Europe/London",
      lastSyncAt: "2026-09-04T12:00:00.000Z",
      lastSyncAgeMs: 1_000,
      lastSuccessfulSyncAt: "2026-09-04T12:00:00.000Z",
      lastSuccessfulSyncRunId: "sync-1",
      lastAttemptAt: "2026-09-04T12:00:00.000Z",
      lastAttemptStatus: "SUCCEEDED",
      lastSyncError: null,
      mtdComparisonComparable: true,
      metadataStaleCount: 0,
      syncState: "fresh",
    },
    scorecard: {
      ...periods(current, previous),
      leadsThisWeek: current.leads,
      learningProgress: null,
      learningLeadsTarget: null,
      budget: { dailyCents: null, monthlyCents: null },
      spendStatus: { status: "unknown", label: "Unknown", detail: "No target budget configured.", spendCents: current.spendCents, expectedCents: null, budgetCents: null, elapsedDay: null, daysInMonth: null },
    },
    trend: [{ date: "2026-09-04", ...current }],
    heatmap: [],
    ads: [ad],
    campaigns: [],
    adSets: [],
    dataWarnings: {
      today: [],
      "7d": [{ id: "thin-sample", severity: "info", label: "Sample note", detail: "The stored sample is diagnostic." }],
      "14d": [],
      "30d": [],
      mtd: [],
    },
    funnel: {
      metaPixelImpressions: current.impressions,
      metaPixelLinkClicks: current.linkClicks,
      leads: current.leads,
      contacted: null,
      qualified: null,
      callsBooked: null,
      callsAttended: null,
      wonCustomers: null,
      lostCustomers: null,
      metaPixelLeads: current.leads,
      testEmailsExcluded: 0,
      duplicatesCollapsed: 0,
      crmConfigured: false,
    },
    anomalies: [{ metric: "cpl", direction: "down", changePct: -0.02, date: "2026-09-04", message: "CPL is lower than the matched period.", severity: "info" }],
    actionLog: [],
    phase: { label: "Learning", daysIn: 15, totalDays: null, spendPaceCents: current.spendCents, spendPaceBudgetCents: null, exitCriteria: [] },
    triggers: [{ id: "sample", label: "Sample", status: "ok", detail: "Stored sample is available." }],
    recommendations: [recommendation],
    targets: UKTL_CONFIG,
  };
}

function validSummary() {
  const current = "metric:7d-current";
  const warning = "warning:7d:0";
  return {
    schemaVersion: 1,
    headline: { text: "Stored 7d evidence is available for review.", evidenceIds: [current] },
    changes: [{ text: "The current matched 7d period has a lower CPL than the previous matched period.", evidenceIds: [current, "metric:7d-previous"] }],
    possibleCauses: [{ text: "The change may reflect normal delivery variation rather than a durable improvement.", evidenceIds: [current, "metric:7d-previous"], hypothesis: true }],
    known: [{ text: "The account currency is GBP and the account timezone is Europe/London.", evidenceIds: ["meta:sync-state"] }],
    uncertain: [{ text: "CRM outcomes and lead quality are not available in the supplied evidence.", evidenceIds: ["funnel:30d"] }],
    mainRecommendation: null,
    evidence: [current, warning],
    whatToWatch: [{ text: "Watch the next matched period and the configured data warnings before changing delivery.", evidenceIds: [current, warning] }],
  };
}

function validCreative(context) {
  const adId = context.evidence.find((item) => item.id.startsWith("ad:") && item.id !== "ad:creative-coverage")?.id;
  assert.ok(adId);
  const angle = (index) => ({
    name: `Angle ${index}`,
    hook: `A conversational hook ${index}`,
    format: index === 1 ? "Video" : index === 2 ? "Static" : "Carousel",
    scriptOutline: `Open, explain, and invite the next step for angle ${index}.`,
    whyItShouldWork: { text: "This is a hypothesis grounded in the supplied ad metadata and performance evidence.", evidenceIds: [adId], hypothesis: true },
    noveltyAxis: `Different opening and format for angle ${index}.`,
    evidenceIds: [adId],
  });
  return {
    schemaVersion: 1,
    mediaVisibility: "metadata_only",
    mediaDisclosure: "The model supplied disclosure is replaced by the server boundary.",
    winningDna: { text: "The stored copy and performance pattern may support a practical local-lead hypothesis.", evidenceIds: [adId], hypothesis: true },
    angles: [angle(1), angle(2), angle(3)],
    evidence: [adId],
  };
}

test("schemas accept no action, require grounded claims, and reject malformed output", async () => {
  const state = makeState();
  const context = await buildAiBriefingContext(state, "summary");
  const valid = validSummary(context);
  const parsed = parseAiBriefingOutput("summary", valid, context.evidence);
  assert.equal(parsed.mainRecommendation, null);
  assert.ok(parsed.evidence.includes("metric:7d-current"));

  assert.equal(parseAiBriefingOutput("summary", { ...valid, headline: undefined }, context.evidence), null);
  assert.equal(parseAiBriefingOutput("summary", { ...valid, headline: { ...valid.headline, evidenceIds: ["not-supplied"] } }, context.evidence), null);
  assert.equal(parseAiBriefingOutput("summary", { ...valid, possibleCauses: [{ ...valid.possibleCauses[0], hypothesis: false }] }, context.evidence), null);
  assert.equal(parseAiBriefingOutput("summary", "{\"headline\":\"not a schema result\"}", context.evidence), null);
});

test("the AI context carries UKTL configuration, matched metrics, warnings, deterministic evidence, and creative metadata", async () => {
  const state = makeState();
  process.env.META_MARKETING_TOKEN = "secret-token-that-must-not-be-forwarded";
  try {
    const context = await buildAiBriefingContext(state, "creative");
    const promptData = formatAiContextForTest(context);
    assert.match(promptData, /UK Trade Leads/);
    assert.match(promptData, /Current matched 7d/);
    assert.match(promptData, /Previous matched 7d/);
    assert.match(promptData, /recommendation-1/);
    assert.match(promptData, /Sample note/);
    assert.match(promptData, /Get more trade leads/);
    assert.match(promptData, /A practical route to better local enquiries/);
    assert.match(promptData, /LEARN_MORE/);
    assert.match(promptData, /uktl\.example\.test/);
    assert.match(promptData, /Static/);
    assert.match(promptData, /video-1/);
    assert.match(promptData, /image-hash-1/);
    assert.match(promptData, /object-1/);
    assert.match(promptData, /metadata_only/);
    assert.doesNotMatch(promptData, /should-not-be-forwarded/);
    assert.doesNotMatch(promptData, /secret-token-that-must-not-be-forwarded/);
  } finally {
    delete process.env.META_MARKETING_TOKEN;
  }
});

test("missing Anthropic key leaves deterministic operation available and makes no provider call", async () => {
  const { db } = await createDatabase();
  let called = false;
  const result = await generateAndPersistAiBriefing({
    db,
    state: makeState(),
    kind: "summary",
    apiKey: null,
    invoke: async () => {
      called = true;
      return {};
    },
  });
  assert.equal(result, null);
  assert.equal(called, false);
  assert.equal(await db.aiBriefing.count(), 0);
});

test("validated summaries persist durably, deduplicate unchanged state, and read back after reconnect", async () => {
  const { db, path } = await createDatabase();
  const state = makeState();
  let captured;
  const invoke = async (request) => {
    captured = request;
    return validSummary(request.context);
  };
  const first = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", sourceSyncRunId: "sync-1", generatedAt: new Date("2026-09-04T13:00:00.000Z"), invoke });
  assert.equal(first.kind, "summary");
  assert.equal(first.output.mainRecommendation, null);
  assert.equal(first.output.evidence.includes("warning:7d:0"), true);
  assert.match(captured.systemPrompt, /Every claim object/);
  assert.match(captured.userPrompt, /EVIDENCE_JSON_START/);
  assert.equal(await db.aiBriefing.count(), 1);

  const same = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", invoke: async () => { throw new Error("unchanged data should reuse the persisted briefing"); } });
  assert.equal(same.id, first.id);
  assert.equal(await db.aiBriefing.count(), 1);

  await db.$disconnect();
  const reopened = createPrismaClient({ url: `file:${path}` });
  fixtures[fixtures.length - 1].db = reopened;
  const read = await readStoredAiBriefing(reopened, state, "summary");
  assert.equal(read.briefing.id, first.id);
  assert.equal(read.briefing.stale, false);
  assert.equal(read.briefing.output.headline.text, first.output.headline.text);
  assert.equal(read.briefing.evidence.find((item) => item.id === "metric:7d-current").value.leads, 5);
});

test("changed evidence creates a new hash, while invalid provider output is never saved", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const first = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", generatedAt: new Date("2026-09-04T12:00:00.000Z"), invoke: async ({ context }) => validSummary(context) });
  const changed = makeState();
  changed.scorecard.last7 = bucket({ leads: 9, cplCents: 1_372 });
  const second = await generateAndPersistAiBriefing({ db, state: changed, kind: "summary", apiKey: "test-key", generatedAt: new Date("2026-09-04T12:01:00.000Z"), invoke: async ({ context }) => validSummary(context) });
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.dataHash, first.dataHash);
  assert.equal(await db.aiBriefing.count(), 2);

  const invalidState = makeState();
  await assert.rejects(
    () => generateAndPersistAiBriefing({ db, state: invalidState, kind: "summary", apiKey: "test-key", force: true, invoke: async () => ({ ...validSummary(await buildAiBriefingContext(invalidState, "summary")), headline: { text: "unsupported", evidenceIds: ["unknown"] } }) }),
    AiBriefingValidationError,
  );
  assert.equal(await db.aiBriefing.count(), 2);
});

test("provider failures are surfaced without replacing the last valid persisted briefing", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const first = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", generatedAt: new Date("2026-09-04T12:00:00.000Z"), invoke: async ({ context }) => validSummary(context) });
  await assert.rejects(
    () => generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", force: true, invoke: async () => { throw new Error("provider timeout with secret-like details"); } }),
    AiBriefingProviderError,
  );
  const read = await readStoredAiBriefing(db, state, "summary");
  assert.equal(read.briefing.id, first.id);
  assert.equal(await db.aiBriefing.count(), 1);
});

test("creative brief requires three grounded hypotheses and discloses unseen media", async () => {
  const { db } = await createDatabase();
  let captured;
  const result = await generateAndPersistAiBriefing({
    db,
    state: makeState(),
    kind: "creative",
    apiKey: "test-key",
    invoke: async (request) => {
      captured = request;
      return validCreative(request.context);
    },
  });
  assert.equal(result.output.mediaVisibility, "metadata_only");
  assert.equal(result.output.mediaDisclosure, MEDIA_DISCLOSURE);
  assert.equal(result.output.angles.length, 3);
  assert.match(captured.userPrompt, /image-hash-1/);
  assert.match(captured.systemPrompt, /Never say that you saw/);

  const context = await buildAiBriefingContext(makeState(), "creative");
  const invalid = validCreative(context);
  invalid.angles.pop();
  assert.equal(parseAiBriefingOutput("creative", invalid, context.evidence), null);
});

test("direct persistence rejects invalid output before inserting a row", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const context = await buildAiBriefingContext(state, "summary");
  await assert.rejects(
    () => persistAiBriefing(db, {
      kind: "summary",
      scope: context.scope,
      period: "30d",
      dataHash: context.dataHash,
      output: { schemaVersion: 1 },
      evidence: context.evidence,
      provider: "anthropic",
      model: "test-model",
      sourceSyncRunId: "sync-1",
    }),
    /failed schema or evidence validation/,
  );
  assert.equal(await db.aiBriefing.count(), 0);
  await assert.rejects(
    () => generateAndPersistAiBriefing({ db, state: { ...state, meta: { ...state.meta, adAccountId: null } }, kind: "summary", apiKey: "test-key" }),
    AiBriefingInputError,
  );
});

test("latest reads are exact-scope and mark a briefing stale when stored evidence changes", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const context = await buildAiBriefingContext(state, "summary");
  const output = parseAiBriefingOutput("summary", validSummary(), context.evidence);
  const first = await persistAiBriefing(db, {
    kind: "summary",
    scope: context.scope,
    period: "30d",
    dataHash: context.dataHash,
    output,
    evidence: context.evidence,
    provider: "anthropic",
    model: "test-model",
    sourceSyncRunId: "sync-1",
    generatedAt: new Date("2026-09-04T12:00:00.000Z"),
  });
  const otherCampaign = { ...state, meta: { ...state.meta, campaignId: "other-campaign" } };
  const otherRead = await readStoredAiBriefing(db, otherCampaign, "summary");
  assert.equal(otherRead.briefing, null);
  const changed = makeState();
  changed.scorecard.last7 = bucket({ leads: 99, cplCents: 125 });
  const staleRead = await readStoredAiBriefing(db, changed, "summary");
  assert.equal(staleRead.briefing.id, first.id);
  assert.equal(staleRead.briefing.stale, true);
});

test("persists one durable row per evidence snapshot and rejects tampered evidence", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const first = await generateAndPersistAiBriefing({
    db,
    state,
    kind: "summary",
    apiKey: "test-key",
    generatedAt: new Date("2026-09-04T12:00:00.000Z"),
    invoke: async ({ context }) => validSummary(context),
  });
  const regenerated = await generateAndPersistAiBriefing({
    db,
    state,
    kind: "summary",
    apiKey: "test-key",
    force: true,
    generatedAt: new Date("2026-09-04T13:00:00.000Z"),
    invoke: async ({ context }) => validSummary(context),
  });
  assert.equal(regenerated.id, first.id);
  assert.equal(await db.aiBriefing.count(), 1);

  await db.aiBriefing.update({
    where: { id: first.id },
    data: { evidence: JSON.stringify(first.evidence.map((item) => item.id === "metric:7d-current" ? { ...item, value: { tampered: true } } : item)) },
  });
  const tamperedRead = await readStoredAiBriefing(db, state, "summary");
  assert.equal(tamperedRead.briefing, null);
});

test("verifies source provenance and throttles repeated forced generation", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  const context = await buildAiBriefingContext(state, "summary");
  await assert.rejects(
    () => persistAiBriefing(db, {
      kind: "summary",
      scope: context.scope,
      period: "30d",
      dataHash: context.dataHash,
      output: validSummary(),
      evidence: context.evidence,
      provider: "anthropic",
      model: "test-model",
      sourceSyncRunId: "missing-sync",
    }),
    /successful matching run/,
  );

  const first = await generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", invoke: async ({ context }) => validSummary(context) });
  await assert.rejects(
    () => generateAndPersistAiBriefing({ db, state, kind: "summary", apiKey: "test-key", force: true, invoke: async () => { throw new Error("provider should not be called while throttled"); } }),
    AiBriefingRateLimitError,
  );
  assert.equal((await readStoredAiBriefing(db, state, "summary")).briefing.id, first.id);
});

test("refuses creative generation when selected ads have no stored creative fields", async () => {
  const { db } = await createDatabase();
  const state = makeState();
  state.ads = [{ ...state.ads[0], creativeId: null, title: null, body: null, callToAction: null, destinationUrl: null, format: null, thumbnailUrl: null, imageUrl: null, videoId: null, imageHash: null, objectId: null, urlTags: null }];
  await assert.rejects(
    () => generateAndPersistAiBriefing({ db, state, kind: "creative", apiKey: "test-key", invoke: async () => ({}) }),
    /No stored ad creative fields/,
  );
});
