import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { SyncAlreadyRunningError, syncMeta } from "@/lib/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json({ ok: true, ...(await syncMeta({ trigger: "manual" })) });
  } catch (error) {
    if (error instanceof SyncAlreadyRunningError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    console.error("manual Meta sync failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ ok: false, error: "Meta sync failed; the last successful data remains available." }, { status: 500 });
  }
}
