import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import {
  MetaActionError,
  loadMetaActionConfig,
  metaActionGate,
  proposeMetaAction,
  readMetaActionViews,
} from "@/lib/meta-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function actionErrorResponse(error: unknown): NextResponse {
  if (error instanceof MetaActionError) {
    return noStore({ error: error.message, ...(error.action ? { action: error.action } : {}) }, { status: error.statusCode });
  }
  console.error("Meta action request failed:", error instanceof Error ? error.name : "unknown error");
  return noStore({ error: "Meta action is unavailable; no provider mutation was confirmed." }, { status: 500 });
}

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const config = loadMetaActionConfig();
    return noStore({ actions: await readMetaActionViews(prisma, config.accountId, config), gate: metaActionGate() });
  } catch (error) {
    return actionErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStore({ error: "A JSON action proposal is required" }, { status: 400 });
  }
  try {
    const result = await proposeMetaAction(prisma, body as { recommendationFingerprint: unknown; action: unknown; dailyBudgetMinor?: unknown; idempotencyKey?: unknown });
    return noStore(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return actionErrorResponse(error);
  }
}
