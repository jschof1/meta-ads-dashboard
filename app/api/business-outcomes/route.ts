import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { readBusinessOutcomes } from "@/lib/business-outcomes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await readBusinessOutcomes(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Live business reporting is unavailable. Refresh to retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
