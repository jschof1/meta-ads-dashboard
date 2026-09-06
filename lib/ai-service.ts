import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { PrismaClient } from "@prisma/client";
import {
  AiCreativeOutputSchema,
  AiSummaryOutputSchema,
  buildAiBriefingContext,
  hasCreativeEvidence,
  aiSystemPrompt,
  aiUserPrompt,
  aiBriefingSnapshotKey,
  parseAiBriefingOutput,
  type AiBriefingContext,
  type AiBriefingKind,
  type AiBriefingOutput,
  type AiBriefingView,
  type AiSummaryOutput,
  type AiCreativeOutput,
  DEFAULT_ANTHROPIC_MODEL,
} from "@/lib/ai-briefings";
import { persistAiBriefing, readLatestAiBriefing } from "@/lib/ai-briefing-store";
import type { DashboardState } from "@/lib/state-types";

export class AiBriefingInputError extends Error {}
export class AiBriefingProviderError extends Error {}
export class AiBriefingValidationError extends Error {}
export class AiBriefingRateLimitError extends Error {}

export const AI_BRIEFING_MIN_GENERATION_INTERVAL_MS = 60_000;

export type AiModelRequest = {
  kind: AiBriefingKind;
  context: AiBriefingContext;
  systemPrompt: string;
  userPrompt: string;
};

export type AiModelInvoker = (request: AiModelRequest) => Promise<unknown>;

const inFlight = new Map<string, Promise<AiBriefingView>>();

function configuredModel(): string {
  const value = process.env.ANTHROPIC_MODEL?.trim();
  return value ? value.slice(0, 160) : DEFAULT_ANTHROPIC_MODEL;
}

function providerErrorMessage(response: { stop_reason: string | null }): string {
  if (response.stop_reason === "refusal") return "Anthropic refused the structured briefing request";
  if (response.stop_reason === "max_tokens") return "Anthropic reached the structured briefing token limit";
  return "Anthropic returned no structured briefing";
}

async function invokeAnthropic(request: AiModelRequest, apiKey: string): Promise<unknown> {
  const anthropic = new Anthropic({
    apiKey,
    maxRetries: 0,
    // First-use structured-output grammar compilation can exceed 20 seconds.
    // Keep a bounded request below the route's 60-second runtime budget.
    timeout: 45_000,
  });
  const common = {
    model: configuredModel(),
    system: request.systemPrompt,
    messages: [{ role: "user" as const, content: request.userPrompt }],
  };
  if (request.kind === "summary") {
    const format = zodOutputFormat(AiSummaryOutputSchema);
    const response = await anthropic.messages.create({
      ...common,
      max_tokens: 1_800,
      output_config: { format },
    });
    if (response.stop_reason !== "end_turn" && response.stop_reason !== "stop_sequence") {
      throw new AiBriefingProviderError(providerErrorMessage(response));
    }
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new AiBriefingProviderError("Anthropic returned no structured briefing text");
    try {
      return format.parse(textBlock.text);
    } catch {
      throw new AiBriefingValidationError("Anthropic briefing failed schema validation");
    }
  }
  const format = zodOutputFormat(AiCreativeOutputSchema);
  const response = await anthropic.messages.create({
    ...common,
    max_tokens: 2_400,
    output_config: { format },
  });
  if (response.stop_reason !== "end_turn" && response.stop_reason !== "stop_sequence") {
    throw new AiBriefingProviderError(providerErrorMessage(response));
  }
  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new AiBriefingProviderError("Anthropic returned no structured briefing text");
  try {
    return format.parse(textBlock.text);
  } catch {
    throw new AiBriefingValidationError("Anthropic briefing failed schema validation");
  }
}

export type GenerateAiBriefingInput = {
  db: PrismaClient;
  state: DashboardState;
  kind: AiBriefingKind;
  apiKey?: string | null;
  sourceSyncRunId?: string | null;
  force?: boolean;
  generatedAt?: Date;
  invoke?: AiModelInvoker;
};

async function generateForContext(
  input: GenerateAiBriefingInput,
  context: AiBriefingContext,
  apiKey: string,
  sourceSyncRunId: string,
): Promise<AiBriefingView> {
  const existing = await readLatestAiBriefing(input.db, {
    kind: input.kind,
    scope: context.scope,
    sourceSyncRunId: context.sourceSyncRunId,
    currentDataHash: context.dataHash,
  });
  if (existing && !input.force && !existing.stale) return existing;
  if (existing && !input.force && existing.dataHash === context.dataHash) {
    // A new successful sync can have identical business evidence. Rebind the
    // durable snapshot to that verified run without paying for another model
    // call, while keeping the provenance current.
    return persistAiBriefing(input.db, {
      kind: input.kind,
      scope: context.scope,
      period: context.period,
      dataHash: context.dataHash,
      output: existing.output,
      evidence: existing.evidence,
      provider: existing.provider,
      model: existing.model,
      sourceSyncRunId,
      generatedAt: new Date(existing.generatedAt),
    });
  }
  if (existing) {
    const ageMs = Date.now() - Date.parse(existing.generatedAt);
    if (Number.isFinite(ageMs) && ageMs < AI_BRIEFING_MIN_GENERATION_INTERVAL_MS) {
      throw new AiBriefingRateLimitError("AI briefing regeneration is temporarily rate-limited; the last persisted briefing remains available.");
    }
  }
  let rawOutput: unknown;
  try {
    const invoke = input.invoke ?? ((request: AiModelRequest) => invokeAnthropic(request, apiKey));
    rawOutput = await invoke({
      kind: input.kind,
      context,
      systemPrompt: aiSystemPrompt(input.kind),
      userPrompt: aiUserPrompt(context),
    });
  } catch (error) {
    if (error instanceof AiBriefingProviderError || error instanceof AiBriefingValidationError) throw error;
    throw new AiBriefingProviderError("Anthropic briefing request failed");
  }
  const output = parseAiBriefingOutput(input.kind, rawOutput, context.evidence);
  if (!output) throw new AiBriefingValidationError("Anthropic briefing failed schema or evidence validation");
  return persistAiBriefing(input.db, {
    kind: input.kind,
    scope: context.scope,
    period: context.period,
    dataHash: context.dataHash,
    output,
    evidence: context.evidence,
    provider: "anthropic",
    model: configuredModel(),
    sourceSyncRunId,
    generatedAt: input.generatedAt,
  });
}

/** Generate once for a data hash, or force a new persisted snapshot on demand. */
export async function generateAndPersistAiBriefing(input: GenerateAiBriefingInput): Promise<AiBriefingView | null> {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return null;
  const context = await buildAiBriefingContext(input.state, input.kind);
  if (!context.scope.accountId) {
    throw new AiBriefingInputError("No successful Meta account is available for an AI briefing");
  }
  if (!context.sourceSyncRunId || (input.sourceSyncRunId && input.sourceSyncRunId !== context.sourceSyncRunId)) {
    throw new AiBriefingInputError("AI briefing data is not tied to the current successful Meta sync");
  }
  if (input.kind === "creative") {
    const selected = new Set(context.selectedAdIds);
    if (!input.state.ads.some((ad) => selected.has(ad.adId) && hasCreativeEvidence(ad))) {
      throw new AiBriefingInputError("No stored ad creative fields are available for a creative brief");
    }
  }
  const sourceSyncRunId = context.sourceSyncRunId;
  const snapshotKey = aiBriefingSnapshotKey(input.kind, context.scope, context.period, context.dataHash);
  const running = inFlight.get(snapshotKey);
  if (running) return running;
  const work = generateForContext(input, context, apiKey, sourceSyncRunId);
  inFlight.set(snapshotKey, work);
  try {
    return await work;
  } finally {
    if (inFlight.get(snapshotKey) === work) inFlight.delete(snapshotKey);
  }
}

export type StoredBriefingResult = {
  briefing: AiBriefingView | null;
  currentDataHash: string | null;
};

export async function readStoredAiBriefing(
  db: PrismaClient,
  state: DashboardState,
  kind: AiBriefingKind,
): Promise<StoredBriefingResult> {
  const context = await buildAiBriefingContext(state, kind);
  if (!context.scope.accountId) return { briefing: null, currentDataHash: context.dataHash };
  return {
    briefing: await readLatestAiBriefing(db, {
      kind,
      scope: context.scope,
      sourceSyncRunId: context.sourceSyncRunId,
      currentDataHash: context.dataHash,
    }),
    currentDataHash: context.dataHash,
  };
}

export function isSummaryOutput(value: AiBriefingOutput): value is AiSummaryOutput {
  return "headline" in value;
}

export function isCreativeOutput(value: AiBriefingOutput): value is AiCreativeOutput {
  return "angles" in value;
}
