import type { PrismaClient } from "@prisma/client";
import {
  AI_BRIEFING_KINDS,
  AI_BRIEFING_PERIOD,
  aiBriefingDataHash,
  aiBriefingSnapshotKey,
  parseAiBriefingOutput,
  parseStoredAiBriefing,
  type AiBriefingContext,
  type AiBriefingKind,
  type AiBriefingOutput,
  type AiBriefingScope,
  type AiBriefingView,
  type AiEvidenceItem,
} from "@/lib/ai-briefings";

export type AiBriefingPersistenceInput = {
  kind: AiBriefingKind;
  scope: AiBriefingScope;
  period: typeof AI_BRIEFING_PERIOD;
  dataHash: string;
  output: AiBriefingOutput;
  evidence: readonly AiEvidenceItem[];
  provider: string;
  model: string;
  sourceSyncRunId: string;
  generatedAt?: Date;
};

function isoDate(value: Date): string | null {
  return Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

async function hasValidSourceSyncRun(
  db: PrismaClient,
  sourceSyncRunId: string,
  scope: AiBriefingScope,
): Promise<boolean> {
  const source = await db.syncRun.findUnique({
    where: { id: sourceSyncRunId },
    select: { accountId: true, campaignId: true, attributionKey: true, status: true, finishedAt: true },
  });
  return source?.status === "SUCCEEDED"
    && source.finishedAt != null
    && source.accountId === scope.accountId
    && source.campaignId === scope.campaignId
    && source.attributionKey === scope.attributionKey;
}

export async function readLatestAiBriefing(
  db: PrismaClient,
  input: { kind: AiBriefingKind; scope: AiBriefingScope; sourceSyncRunId: string | null; currentDataHash?: string | null },
): Promise<AiBriefingView | null> {
  if (!input.sourceSyncRunId) return null;
  const rows = await db.aiBriefing.findMany({
    where: {
      kind: input.kind,
      accountId: input.scope.accountId,
      campaignId: input.scope.campaignId,
      attributionKey: input.scope.attributionKey,
    },
    orderBy: [{ generatedAt: "desc" }, { createdAt: "desc" }],
    take: 20,
  });
  for (const row of rows) {
    if (!(AI_BRIEFING_KINDS as readonly string[]).includes(row.kind)
      || row.kind !== input.kind
      || row.period !== AI_BRIEFING_PERIOD
      || !row.dataHash
      || !row.provider
      || !row.model
      || !row.sourceSyncRunId
      || !row.snapshotKey
      || row.snapshotKey !== aiBriefingSnapshotKey(input.kind, input.scope, AI_BRIEFING_PERIOD, row.dataHash)
      || !(await hasValidSourceSyncRun(db, row.sourceSyncRunId, input.scope))) continue;
    const parsed = parseStoredAiBriefing(input.kind, row.output, row.evidence);
    const generatedAt = isoDate(row.generatedAt);
    if (!parsed || !generatedAt || aiBriefingDataHash(input.kind, input.scope, AI_BRIEFING_PERIOD, parsed.evidence) !== row.dataHash) {
      console.error("Stored AI briefing failed validation and was omitted", row.id);
      continue;
    }
    return {
      id: row.id,
      kind: input.kind,
      period: AI_BRIEFING_PERIOD,
      dataHash: row.dataHash,
      provider: row.provider,
      model: row.model,
      sourceSyncRunId: row.sourceSyncRunId,
      generatedAt,
      output: parsed.output,
      evidence: parsed.evidence,
      stale: (input.currentDataHash != null && row.dataHash !== input.currentDataHash)
        || row.sourceSyncRunId !== input.sourceSyncRunId,
    };
  }
  return null;
}

export async function persistAiBriefing(
  db: PrismaClient,
  input: AiBriefingPersistenceInput,
): Promise<AiBriefingView> {
  const validated = parseAiBriefingOutput(input.kind, input.output, input.evidence);
  if (!validated) throw new Error("AI briefing failed schema or evidence validation");
  if (!input.provider.trim() || !input.model.trim()) throw new Error("AI briefing failed persistence validation");
  if (!(await hasValidSourceSyncRun(db, input.sourceSyncRunId, input.scope))) {
    throw new Error("AI briefing source sync was not a successful matching run");
  }
  const generatedAt = input.generatedAt ?? new Date();
  const encodedOutput = JSON.stringify(validated);
  const encodedEvidence = JSON.stringify(input.evidence);
  const parsed = parseStoredAiBriefing(input.kind, encodedOutput, encodedEvidence);
  const iso = isoDate(generatedAt);
  if (!parsed || !iso
    || !/^[a-f0-9]{64}$/.test(input.dataHash)
    || aiBriefingDataHash(input.kind, input.scope, input.period, parsed.evidence) !== input.dataHash) {
    throw new Error("AI briefing data hash did not match its evidence");
  }
  const snapshotKey = aiBriefingSnapshotKey(input.kind, input.scope, input.period, input.dataHash);
  const canonicalEvidence = JSON.stringify(parsed.evidence);

  const row = await db.aiBriefing.upsert({
    where: { snapshotKey },
    create: {
      kind: input.kind,
      accountId: input.scope.accountId,
      campaignId: input.scope.campaignId,
      attributionKey: input.scope.attributionKey,
      period: input.period,
      dataHash: input.dataHash,
      output: encodedOutput,
      evidence: canonicalEvidence,
      provider: input.provider,
      model: input.model,
      sourceSyncRunId: input.sourceSyncRunId,
      snapshotKey,
      generatedAt,
    },
    update: {
      output: encodedOutput,
      evidence: canonicalEvidence,
      provider: input.provider,
      model: input.model,
      sourceSyncRunId: input.sourceSyncRunId,
      generatedAt,
    },
  });
  return {
    id: row.id,
    kind: input.kind,
    period: AI_BRIEFING_PERIOD,
    dataHash: row.dataHash,
    provider: row.provider,
    model: row.model,
    sourceSyncRunId: row.sourceSyncRunId,
    generatedAt: iso,
    output: parsed.output,
    evidence: parsed.evidence,
    stale: false,
  };
}

export function briefingScopeFromContext(context: AiBriefingContext): AiBriefingScope | null {
  return context.scope.accountId ? context.scope : null;
}
