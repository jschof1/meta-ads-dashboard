import { NextRequest, NextResponse } from "next/server";
import { validateCronEnvironment, validateDatabaseEnvironment } from "@/lib/env";
import { HighLevelAlreadyRunningError, syncHighLevel } from "@/lib/highlevel-sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (validateCronEnvironment().length > 0 || !secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (validateDatabaseEnvironment().length > 0) {
    return NextResponse.json({ ok: false, error: "HighLevel sync is unavailable; the database is not configured." }, { status: 503 });
  }
  try {
    const result = await syncHighLevel({ trigger: "cron" });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof HighLevelAlreadyRunningError) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    console.error("sync-highlevel failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ ok: false, error: "HighLevel sync failed; the last successful CRM snapshot remains available." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
