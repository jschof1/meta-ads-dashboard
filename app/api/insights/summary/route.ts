import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { buildDashboardState } from "@/lib/read-model";
import {
  AiBriefingInputError,
  AiBriefingProviderError,
  AiBriefingRateLimitError,
  AiBriefingValidationError,
  generateAndPersistAiBriefing,
  readStoredAiBriefing,
} from "@/lib/ai-service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function logFailure(label: string, error: unknown): void {
  console.error(`${label}:`, error instanceof Error ? error.name : "unknown error");
}

function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const state = await buildDashboardState();
    const result = await readStoredAiBriefing(prisma, state, "summary");
    return noStoreJson({
      enabled: aiEnabled(),
      status: result.briefing ? "available" : "not_generated",
      briefing: result.briefing,
      currentDataHash: result.currentDataHash,
      message: result.briefing
        ? result.briefing.stale
          ? "This briefing was generated from an older stored data snapshot. Regenerate it before relying on the explanation."
          : ""
        : "No persisted AI briefing yet. Generate one after a successful Meta sync.",
    });
  } catch (error) {
    logFailure("AI summary read failed", error);
    return noStoreJson({ error: "AI summary unavailable; stored dashboard data could not be read." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  if (!aiEnabled()) {
    return noStoreJson({
      enabled: false,
      status: "disabled",
      briefing: null,
      message: "ANTHROPIC_API_KEY is not configured. Deterministic stored analysis remains available.",
    });
  }
  try {
    const state = await buildDashboardState();
    const briefing = await generateAndPersistAiBriefing({
      db: prisma,
      state,
      kind: "summary",
      apiKey: process.env.ANTHROPIC_API_KEY,
      force: true,
    });
    return noStoreJson({ enabled: true, status: briefing ? "generated" : "disabled", briefing });
  } catch (error) {
    logFailure("AI summary generation failed", error);
    if (error instanceof AiBriefingRateLimitError) {
      return noStoreJson({ error: error.message }, { status: 429 });
    }
    if (error instanceof AiBriefingInputError) {
      return noStoreJson({ error: error.message }, { status: 400 });
    }
    if (error instanceof AiBriefingValidationError) {
      return noStoreJson({ error: "AI summary was rejected because its structured output was not trustworthy. Nothing was saved." }, { status: 502 });
    }
    if (error instanceof AiBriefingProviderError) {
      return noStoreJson({ error: "AI summary could not be generated. The last persisted briefing remains available." }, { status: 502 });
    }
    return noStoreJson({ error: "AI summary unavailable; dashboard data could not be read." }, { status: 503 });
  }
}
