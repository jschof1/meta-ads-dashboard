import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { createHighLevelClient, HighLevelApiError, type HighLevelClient, type HighLevelCollection } from "@/lib/highlevel";
import { loadHighLevelSettings, type HighLevelSettings } from "@/lib/highlevel-config";
import { normalizeContact, normalizeOpportunity, validatePipelineMapping, type NormalizedCrmContact, type NormalizedCrmOpportunity } from "@/lib/crm-attribution";

export type HighLevelSyncTrigger = "cron" | "manual";

export class HighLevelAlreadyRunningError extends Error {
  readonly name = "HighLevelAlreadyRunningError";

  constructor() {
    super("A HighLevel sync is already running for this location");
  }
}

export class HighLevelMappingError extends Error {
  readonly name = "HighLevelMappingError";

  constructor(messages: string[]) {
    super(messages.join(" "));
  }
}

export type HighLevelSyncResult = {
  runId?: string;
  status: "SUCCEEDED" | "DISABLED";
  contactsFetched?: number;
  opportunitiesFetched?: number;
  contactsWritten?: number;
  opportunitiesWritten?: number;
  warning?: string | null;
  reason?: string;
};

export type HighLevelSyncOptions = {
  db?: PrismaClient;
  config?: HighLevelSettings;
  client?: HighLevelClient;
  trigger?: HighLevelSyncTrigger;
  now?: Date;
  clock?: () => Date;
};

const TRANSACTION_TIMEOUT_MS = 45_000;

function safeErrorMessage(error: unknown, config: HighLevelSettings): string {
  const source = error instanceof Error ? error.message : String(error);
  const secrets = [config.token, process.env.HIGHLEVEL_TOKEN, process.env.HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN]
    .filter((secret): secret is string => Boolean(secret));
  return secrets
    .reduce((message, secret) => message.replaceAll(secret, "[REDACTED]"), source)
    .replace(/(access[_-]?token|authorization|api[_-]?key|secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 2_000);
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function lockKey(config: HighLevelSettings): string {
  return `highlevel:${config.locationId}:${config.pipelineId}`;
}

async function acquireRun(
  db: PrismaClient,
  config: HighLevelSettings,
  input: { trigger: HighLevelSyncTrigger; now: Date },
) {
  const key = lockKey(config);
  const owner = randomUUID();
  const lockExpiresAt = new Date(input.now.getTime() + config.leaseSeconds * 1_000);
  try {
    return await db.$transaction(async (tx) => {
      const active = await tx.crmSyncRun.findFirst({
        where: { lockKey: key, status: "RUNNING", lockExpiresAt: { gt: input.now } },
        orderBy: { startedAt: "desc" },
      });
      if (active) throw new HighLevelAlreadyRunningError();

      const expired = await tx.crmSyncRun.findFirst({
        where: { lockKey: key, status: "RUNNING", lockExpiresAt: { lte: input.now } },
        orderBy: { startedAt: "asc" },
      });
      if (expired) {
        await tx.crmSyncRun.update({
          where: { id: expired.id },
          data: {
            status: "FAILED",
            finishedAt: input.now,
            error: "HighLevel sync lease expired before completion; reclaimed safely by a later run.",
            lockKey: null,
            lockOwner: null,
            lockExpiresAt: null,
          },
        });
      }

      return tx.crmSyncRun.create({
        data: {
          provider: "highlevel",
          locationId: config.locationId as string,
          pipelineId: config.pipelineId as string,
          apiVersion: config.apiVersion,
          mappingHash: config.mappingHash as string,
          trigger: input.trigger,
          status: "RUNNING",
          startedAt: input.now,
          lockKey: key,
          lockOwner: owner,
          lockExpiresAt,
          traceId: randomUUID(),
        },
      });
    });
  } catch (error) {
    if (error instanceof HighLevelAlreadyRunningError || isUniqueConstraintError(error)) throw new HighLevelAlreadyRunningError();
    throw error;
  }
}

function startLeaseHeartbeat(db: PrismaClient, runId: string, owner: string, leaseSeconds: number): { stop: () => Promise<void> } {
  const intervalMs = Math.max(1_000, Math.min(30_000, Math.floor(leaseSeconds * 1_000 / 3)));
  let stopped = false;
  let inFlight: Promise<void> | null = null;

  async function renew(): Promise<void> {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    inFlight = (async () => {
      try {
        await db.crmSyncRun.updateMany({
          where: { id: runId, status: "RUNNING", lockOwner: owner },
          data: { lockExpiresAt: new Date(Date.now() + leaseSeconds * 1_000) },
        });
      } catch (error) {
        console.error("HighLevel sync lease renewal failed:", error instanceof Error ? error.name : "unknown error");
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  const timer = setInterval(() => { void renew(); }, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await renew();
    },
  };
}

async function markFailed(db: PrismaClient, runId: string, owner: string | null | undefined, config: HighLevelSettings, now: Date, error: unknown): Promise<void> {
  try {
    await db.crmSyncRun.updateMany({
      where: { id: runId, lockOwner: owner ?? undefined },
      data: {
        status: "FAILED",
        finishedAt: now,
        error: safeErrorMessage(error, config),
        lockKey: null,
        lockOwner: null,
        lockExpiresAt: null,
      },
    });
  } catch (updateError) {
    console.error("Unable to mark HighLevel sync as failed:", updateError instanceof Error ? updateError.name : "unknown error");
  }
}

function warningFor(input: {
  rawContacts: number;
  contacts: NormalizedCrmContact[];
  rawOpportunities: number;
  opportunities: NormalizedCrmOpportunity[];
  contactsTruncated: boolean;
  opportunitiesTruncated: boolean;
  contactsTotal: number | null;
  opportunitiesTotal: number | null;
  pipelineWarnings: string[];
}): string | null {
  const warnings = [...input.pipelineWarnings];
  if (input.contactsTruncated) warnings.push(`HighLevel contact polling reached HIGHLEVEL_MAX_RECORDS${input.contactsTotal != null ? ` (${input.contactsTotal} provider rows reported)` : ""}; the stored contact snapshot is partial.`);
  if (input.opportunitiesTruncated) warnings.push(`HighLevel opportunity polling reached HIGHLEVEL_MAX_RECORDS${input.opportunitiesTotal != null ? ` (${input.opportunitiesTotal} provider rows reported)` : ""}; the stored opportunity snapshot is partial.`);
  if (input.rawContacts !== input.contacts.length) warnings.push(`${input.rawContacts - input.contacts.length} contact row(s) were skipped because the id or location was invalid.`);
  if (input.rawOpportunities !== input.opportunities.length) warnings.push(`${input.rawOpportunities - input.opportunities.length} opportunity row(s) were skipped because the id, location, pipeline or status was invalid.`);
  const missingDates = input.contacts.filter((contact) => contact.dateAdded == null).length;
  if (missingDates > 0) warnings.push(`${missingDates} contact row(s) have no usable creation date; cohort metrics will exclude them.`);
  const unmapped = input.opportunities.filter((opportunity) => opportunity.semanticStage == null).length;
  if (unmapped > 0) warnings.push(`${unmapped} opportunity row(s) have an unmapped stage or status and remain visible without a funnel stage.`);
  const wonWithoutValue = input.opportunities.filter((opportunity) => opportunity.semanticStage === "wonCustomer" && opportunity.valueMajorUnits == null).length;
  if (wonWithoutValue > 0) warnings.push(`${wonWithoutValue} won opportunity row(s) have no valid monetary value; attributed revenue remains incomplete.`);
  return warnings.length > 0 ? warnings.join(" ").slice(0, 8_000) : null;
}

async function persistSnapshot(
  db: PrismaClient,
  runId: string,
  owner: string,
  config: HighLevelSettings,
  contacts: NormalizedCrmContact[],
  opportunities: NormalizedCrmOpportunity[],
  contactsFetched: number,
  opportunitiesFetched: number,
  warning: string | null,
  completedAt: Date,
): Promise<void> {
  await db.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const contact of contacts) {
      await tx.crmContact.upsert({
        where: { locationId_highLevelId: { locationId: contact.locationId, highLevelId: contact.highLevelId } },
        create: {
          ...contact,
          clickIds: JSON.stringify(contact.clickIds),
          attribution: JSON.stringify(contact.attribution),
          sourceSyncRunId: runId,
        },
        update: {
          locationId: contact.locationId,
          dateAdded: contact.dateAdded,
          dateUpdated: contact.dateUpdated,
          attributionGranularity: contact.attributionGranularity,
          metaAdId: contact.metaAdId,
          metaCampaignId: contact.metaCampaignId,
          utmSource: contact.utmSource,
          utmMedium: contact.utmMedium,
          utmCampaign: contact.utmCampaign,
          utmContent: contact.utmContent,
          clickIds: JSON.stringify(contact.clickIds),
          attribution: JSON.stringify(contact.attribution),
          sourceSyncRunId: runId,
        },
      });
    }
    for (const opportunity of opportunities) {
      await tx.crmOpportunity.upsert({
        where: { locationId_pipelineId_highLevelId: { locationId: opportunity.locationId, pipelineId: opportunity.pipelineId, highLevelId: opportunity.highLevelId } },
        create: { ...opportunity, sourceSyncRunId: runId },
        update: {
          locationId: opportunity.locationId,
          contactId: opportunity.contactId,
          pipelineId: opportunity.pipelineId,
          pipelineStageId: opportunity.pipelineStageId,
          status: opportunity.status,
          semanticStage: opportunity.semanticStage,
          valueMajorUnits: opportunity.valueMajorUnits,
          createdAtProvider: opportunity.createdAtProvider,
          updatedAtProvider: opportunity.updatedAtProvider,
          lastStageChangeAt: opportunity.lastStageChangeAt,
          lastStatusChangeAt: opportunity.lastStatusChangeAt,
          sourceSyncRunId: runId,
        },
      });
    }
    const committed = await tx.crmSyncRun.updateMany({
      where: { id: runId, status: "RUNNING", lockOwner: owner, lockKey: lockKey(config), lockExpiresAt: { gt: completedAt } },
      data: {
        status: "SUCCEEDED",
        finishedAt: completedAt,
        contactsFetched,
        opportunitiesFetched,
        contactsWritten: contacts.length,
        opportunitiesWritten: opportunities.length,
        warning,
        error: null,
        lockKey: null,
        lockOwner: null,
        lockExpiresAt: null,
      },
    });
    if (committed.count !== 1) throw new Error("The HighLevel sync lease was lost before its data could be committed");
  }, { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS });
}

export async function syncHighLevel(options: HighLevelSyncOptions = {}): Promise<HighLevelSyncResult> {
  const db = options.db ?? defaultPrisma;
  const config = options.config ?? loadHighLevelSettings();
  if (!config.providerReady) {
    return {
      status: "DISABLED",
      reason: config.status === "not_configured"
        ? "HighLevel sync is not configured; no provider call was made."
        : config.errors.length > 0
          ? "HighLevel sync configuration is incomplete; no provider call was made."
          : "HighLevel sync is disabled; no provider call was made.",
    };
  }
  const now = options.clock?.() ?? options.now ?? new Date();
  const client = options.client ?? createHighLevelClient({ config });
  const run = await acquireRun(db, config, { trigger: options.trigger ?? "cron", now });
  const heartbeat = startLeaseHeartbeat(db, run.id, run.lockOwner as string, config.leaseSeconds);
  try {
    const pipeline = await client.getPipeline();
    const mappingWarnings = validatePipelineMapping(pipeline, config);
    if (mappingWarnings.length > 0) throw new HighLevelMappingError(mappingWarnings);
    const [contactCollection, opportunityCollection] = await Promise.all([client.listContacts(), client.listOpportunities()]);
    const rawContacts = collectionItems(contactCollection);
    const rawOpportunities = collectionItems(opportunityCollection);
    const contacts = rawContacts.map((raw) => normalizeContact(raw, config)).filter((row): row is NormalizedCrmContact => row != null);
    const opportunities = rawOpportunities.map((raw) => normalizeOpportunity(raw, config)).filter((row): row is NormalizedCrmOpportunity => row != null);
    const warning = warningFor({
      rawContacts: rawContacts.length,
      contacts,
      rawOpportunities: rawOpportunities.length,
      opportunities,
      contactsTruncated: collectionTruncated(contactCollection),
      opportunitiesTruncated: collectionTruncated(opportunityCollection),
      contactsTotal: collectionTotal(contactCollection),
      opportunitiesTotal: collectionTotal(opportunityCollection),
      pipelineWarnings: config.currencyCode ? [] : ["HIGHLEVEL_CURRENCY_CODE is not configured; attributed revenue and ROAS remain unknown."],
    });
    const completedAt = options.clock?.() ?? new Date();
    await persistSnapshot(db, run.id, run.lockOwner as string, config, contacts, opportunities, rawContacts.length, rawOpportunities.length, warning, completedAt);
    await heartbeat.stop();
    return {
      runId: run.id,
      status: "SUCCEEDED",
      contactsFetched: rawContacts.length,
      opportunitiesFetched: rawOpportunities.length,
      contactsWritten: contacts.length,
      opportunitiesWritten: opportunities.length,
      warning,
    };
  } catch (error) {
    await heartbeat.stop();
    await markFailed(db, run.id, run.lockOwner, config, options.clock?.() ?? new Date(), error);
    if (error instanceof HighLevelApiError || error instanceof HighLevelMappingError) throw error;
    throw new Error(safeErrorMessage(error, config));
  }
}

function collectionItems(collection: HighLevelCollection): Record<string, unknown>[] {
  return Array.isArray(collection.items) ? collection.items : [];
}

function collectionTruncated(collection: HighLevelCollection): boolean {
  return collection.truncated === true;
}

function collectionTotal(collection: HighLevelCollection): number | null {
  return typeof collection.providerTotal === "number" ? collection.providerTotal : null;
}
