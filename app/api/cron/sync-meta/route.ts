import { NextRequest, NextResponse } from "next/server";
import { validateCronEnvironment } from "@/lib/env";
import { SyncAlreadyRunningError, syncMeta } from "@/lib/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (validateCronEnvironment().length > 0 || !secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncMeta({ trigger: "cron" })) });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    console.error("sync-meta failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ ok: false, error: "Meta sync failed; the last successful data remains available." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
