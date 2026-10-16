import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { createHighLevelClient } from "./highlevel";
import { loadHighLevelSettings } from "./highlevel-config";
import { readLeadRegisterProvider } from "./lead-register";
import { normalizeCustomerJourney, journeySnapshotSchema, UKTL_LOCATION, UKTL_STRIPE_ACCOUNT, UKTL_META_ACCOUNT, type JourneySnapshot } from "./customer-journey";
import { readStripeSnapshot } from "./stripe-read";
import { accountLocalDate, addCalendarDays } from "./periods";
import { ownedAcquisitionCatalogue } from "./acquisition-catalogue";

type Row = Record<string, unknown>;
const scope = { locationId: UKTL_LOCATION, stripeAccountId: UKTL_STRIPE_ACCOUNT };
export class JourneySyncRunningError extends Error {}

export async function readJourneySubmissions(read: (path: string, stage: string) => Promise<Row>, options: { locationId: string; formId: string; maxRecords: number; now: Date }) {
  const submissions: Row[] = [];
  // The provider's date-only end is exclusive; retain today's receipts while
  // rejecting anything beyond the exact observation time.
  const endAt = addCalendarDays(accountLocalDate(options.now, "Europe/London"), 1);
  for (let page = 1; page <= Math.ceil(options.maxRecords / 100); page++) {
    const params = new URLSearchParams({ locationId: options.locationId, formId: options.formId, startAt: "2026-01-01", endAt, limit: "100", page: String(page) });
    const data = await read(`/forms/submissions?${params}`, "journey submissions");
    const total = (data.meta as Row | undefined)?.total;
    if (!Array.isArray(data.submissions) || typeof total !== "number") throw new Error("CRM form collection incomplete");
    submissions.push(...data.submissions as Row[]);
    if (submissions.length === total) {
      if (submissions.some(s => typeof s.id !== "string" || !s.id || !Number.isFinite(Date.parse(String(s.createdAt)))) || new Set(submissions.map(s => s.id)).size !== submissions.length) throw new Error("CRM form collection incomplete");
      return submissions.filter(s => Date.parse(String(s.createdAt)) <= +options.now && Date.parse(String(s.createdAt)) >= Date.parse("2026-01-01"));
    }
    if (data.submissions.length < 100 || submissions.length > total) throw new Error("CRM form pagination incomplete");
  }
  throw new Error("CRM form collection incomplete");
}

export async function readCustomerJourney(db: PrismaClient = prisma) {
  const [latest, attempt] = await Promise.all([
    db.customerJourneySyncRun.findFirst({ where: { ...scope, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
    db.customerJourneySyncRun.findFirst({ where: scope, orderBy: { startedAt: "desc" } }),
  ]);
  let snapshot: JourneySnapshot | null = null;
  if (latest?.payload) {
    const parsed = journeySnapshotSchema.safeParse(JSON.parse(latest.payload));
    if (!parsed.success || parsed.data.locationId !== scope.locationId) throw new Error("Saved journey snapshot invalid");
    snapshot = parsed.data;
  }
  return { snapshot, attempt };
}

// Atomic compare-and-set permits one writer; incomplete provider reads never
// replace the last completed payload. Existing historical snapshots are kept.
export async function storeJourneyRun(db: PrismaClient, collect: (previous: JourneySnapshot | null) => Promise<JourneySnapshot>) {
  const now = new Date(), owner = randomUUID();
  const run = await db.$transaction(async tx => {
    await tx.customerJourneySyncRun.updateMany({ where: { ...scope, status: "RUNNING", lockExpiresAt: { lte: now } }, data: { status: "FAILED", finishedAt: now, error: "Previous refresh expired", lockKey: null, lockOwner: null, lockExpiresAt: null } });
    try { return await tx.customerJourneySyncRun.create({ data: { ...scope, status: "RUNNING", startedAt: now, lockKey: UKTL_LOCATION, lockOwner: owner, lockExpiresAt: new Date(+now + 900_000) } }); }
    catch (error) { if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new JourneySyncRunningError("Customer refresh already running"); throw error; }
  });
  try {
    const { snapshot: previous } = await readCustomerJourney(db);
    const snapshot = journeySnapshotSchema.parse(await collect(previous));
    if (snapshot.locationId !== UKTL_LOCATION) throw new Error("Journey location mismatch");
    const finishedAt = new Date();
    const updated = await db.customerJourneySyncRun.updateMany({ where: { id: run.id, status: "RUNNING", lockOwner: owner, lockExpiresAt: { gt: finishedAt } }, data: { status: "SUCCEEDED", finishedAt, payload: JSON.stringify(snapshot), lockKey: null, lockOwner: null, lockExpiresAt: null } });
    if (updated.count !== 1) throw new Error("Customer refresh lease expired");
    return snapshot;
  } catch (error) {
    await db.customerJourneySyncRun.updateMany({ where: { id: run.id, status: "RUNNING", lockOwner: owner }, data: { status: "FAILED", finishedAt: new Date(), error: "Provider refresh failed; previous completed snapshot retained", lockKey: null, lockOwner: null, lockExpiresAt: null } });
    throw error;
  }
}

export async function syncCustomerJourney(db: PrismaClient = prisma) {
  if (process.env.CUSTOMER_JOURNEY_SYNC_ENABLED !== "true") throw new Error("Customer journey sync is disabled");
  const config = loadHighLevelSettings();
  const calendarId = process.env.HIGHLEVEL_SALES_CALENDAR_ID, formId = process.env.HIGHLEVEL_LEAD_FORM_ID;
  const accountId = `act_${process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "")}`;
  if (!config.token || config.locationId !== UKTL_LOCATION || accountId !== UKTL_META_ACCOUNT || process.env.META_CAMPAIGN_ID || !config.pipelineId || !/^[A-Za-z0-9_-]+$/.test(calendarId ?? "") || !/^[A-Za-z0-9_-]+$/.test(formId ?? "")) throw new Error("Customer journey provider configuration unavailable");
  return storeJourneyRun(db, async previous => {
    // Share pacing across ALL CRM requests, including contact-search POSTs.
    let lastRequest = 0;
    const pacedFetch: typeof fetch = async (url, init) => {
      const wait = 300 - (Date.now() - lastRequest);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastRequest = Date.now();
      const response = await fetch(url, init);
      if (response.headers.get("x-ratelimit-daily-remaining") === "0") throw new Error("HighLevel daily quota exhausted");
      return response;
    };
    const client = createHighLevelClient({ config, fetcher: pacedFetch });
    const contacts = await client.listContacts(), opportunities = await client.listOpportunities();
    for (const collection of [contacts, opportunities]) {
      if (collection.truncated || (collection.providerTotal != null && collection.items.length !== collection.providerTotal)) throw new Error("CRM collection incomplete");
    }
    const pipeline = await client.getPipeline(); // exact ID and location verified by the adapter
    const qualifiedStageIds = process.env.JOURNEY_QUALIFIED_STAGE_IDS?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    if (qualifiedStageIds.some(id => !pipeline.stages.some(stage => stage.id === id))) throw new Error("Qualification stage is not in the verified pipeline");
    const read = (path: string, stage: string) => readLeadRegisterProvider(path, stage, config.token!, config.apiVersion, pacedFetch);
    const payments: Row[] = [];
    let paymentsComplete = false;
    for (let offset = 0; offset < config.maxRecords; offset += 100) {
      const page = await read(`/payments/transactions?altId=${config.locationId}&altType=location&limit=100&offset=${offset}`, "journey payments");
      if (!Array.isArray(page.data) || typeof page.totalCount !== "number") throw new Error("CRM payment collection incomplete");
      payments.push(...page.data as Row[]);
      if (payments.length === page.totalCount) { paymentsComplete = true; break; }
      if (page.data.length < 100 || payments.length > page.totalCount) throw new Error("CRM payment pagination incomplete");
    }
    if (!paymentsComplete || new Set(payments.map(p => p._id)).size !== payments.length) throw new Error("CRM payment collection incomplete");
    const now = new Date(), calendarEnd = new Date(+now + 90 * 86_400_000), events: Row[] = [];
    // Monthly calendar requests avoid provider range limits. First import
    // includes history; later imports still check historical showed/no-show changes.
    for (let year = 2026; year <= calendarEnd.getUTCFullYear(); year++) for (let month = 0; month < 12; month++) {
      const since = Date.UTC(year, month, 1), until = Math.min(Date.UTC(year, month + 1, 1) - 1, +calendarEnd);
      if (since > +calendarEnd) break;
      const page = await read(`/calendars/events?locationId=${config.locationId}&calendarId=${calendarId}&startTime=${since}&endTime=${until}`, "journey calendar");
      if (!Array.isArray(page.events)) throw new Error("CRM calendar collection incomplete");
      if (page.events.some(e => typeof e.id !== "string" || !e.id)) throw new Error("CRM calendar event identity missing");
      events.push(...page.events as Row[]);
    }
    const submissions = await readJourneySubmissions(read, { locationId: config.locationId!, formId: formId!, maxRecords: config.maxRecords, now });
    const [ads, historical, runs] = await db.$transaction([
      db.ad.findMany(), db.dailyInsight.findMany({ where: { level: "ad", scopeKey: "account" } }),
      db.syncRun.findMany({ where: { accountId, campaignId: null, status: "SUCCEEDED" } }),
    ]);
    const { identities } = ownedAcquisitionCatalogue({ accountId, runs, history: historical, ads });
    const stripe = await readStripeSnapshot();
    return normalizeCustomerJourney({ locationId: config.locationId!, contacts: contacts.items, opportunities: opportunities.items, events: [...new Map(events.map(e => [e.id, e])).values()], submissions,
      payments, stripe, identities, formId: formId!, pipelineId: config.pipelineId!, calendarSince: "2026-01-01", previous: previous ?? undefined,
      qualifiedStageIds, qualifiedTag: process.env.JOURNEY_QUALIFIED_TAG?.trim(),
    });
  });
}
